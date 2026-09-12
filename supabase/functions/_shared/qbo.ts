// Shared helpers for talking to Supabase (service role) and QuickBooks Online.
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

// ---------------------------------------------------------------------------
// Env & errors
// ---------------------------------------------------------------------------
export function env(key: string, required = true): string {
  const v = Deno.env.get(key)
  if (!v && required) throw new Error(`Missing environment variable ${key}`)
  return v ?? ''
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

export function errorResponse(err: unknown): Response {
  if (err instanceof HttpError) return json({ error: err.message }, err.status)
  console.error(err)
  return json({ error: (err as Error)?.message ?? 'Unexpected error' }, 500)
}

// ---------------------------------------------------------------------------
// Supabase clients
// ---------------------------------------------------------------------------
export function adminClient(): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function userClient(req: Request): SupabaseClient {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/** Throws 401/403 unless the caller is a signed-in admin. */
export async function requireAdmin(req: Request): Promise<{ userId: string }> {
  const sb = userClient(req)
  const { data: { user }, error } = await sb.auth.getUser()
  if (error || !user) throw new HttpError(401, 'Not signed in')
  const { data } = await sb.from('qbo_team').select('role').eq('id', user.id).maybeSingle()
  if (data?.role !== 'owner' && data?.role !== 'admin') throw new HttpError(403, 'Admins only')
  return { userId: user.id }
}

// ---------------------------------------------------------------------------
// QuickBooks OAuth
// ---------------------------------------------------------------------------
export type QboEnvironment = 'sandbox' | 'production'
export const QBO_ENVIRONMENT = (Deno.env.get('QBO_ENVIRONMENT') ?? 'production') as QboEnvironment
export const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
export const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
export const SCOPE = 'com.intuit.quickbooks.accounting'

export function apiBase(environment: QboEnvironment): string {
  return environment === 'sandbox'
    ? 'https://sandbox-quickbooks.api.intuit.com'
    : 'https://quickbooks.api.intuit.com'
}

export function oauthRedirectUri(): string {
  return `${env('SUPABASE_URL')}/functions/v1/qbo-oauth`
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
  x_refresh_token_expires_in: number
}

export async function exchangeToken(params: Record<string, string>): Promise<TokenResponse> {
  const basic = btoa(`${env('QBO_CLIENT_ID')}:${env('QBO_CLIENT_SECRET')}`)
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params),
  })
  if (!res.ok) throw new Error(`QuickBooks token request failed (${res.status}): ${await res.text()}`)
  return (await res.json()) as TokenResponse
}

export interface Connection {
  realm_id: string
  company_name: string | null
  environment: QboEnvironment
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
}

export async function saveTokens(
  sb: SupabaseClient,
  realmId: string,
  tok: TokenResponse,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const now = Date.now()
  const { error } = await sb.from('qbo_connections').upsert(
    {
      realm_id: realmId,
      access_token: tok.access_token,
      refresh_token: tok.refresh_token,
      access_expires_at: new Date(now + tok.expires_in * 1000).toISOString(),
      refresh_expires_at: new Date(now + tok.x_refresh_token_expires_in * 1000).toISOString(),
      updated_at: new Date().toISOString(),
      ...extra,
    },
    { onConflict: 'realm_id' },
  )
  if (error) throw error
}

export async function getConnection(sb: SupabaseClient, realmId?: string): Promise<Connection> {
  let q = sb.from('qbo_connections').select('*')
  if (realmId) q = q.eq('realm_id', realmId)
  const { data, error } = await q.order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, 'QuickBooks is not connected yet')
  return data as Connection
}

async function refreshAccessToken(sb: SupabaseClient, conn: Connection): Promise<string> {
  const tok = await exchangeToken({ grant_type: 'refresh_token', refresh_token: conn.refresh_token })
  await saveTokens(sb, conn.realm_id, tok)
  conn.access_token = tok.access_token
  conn.refresh_token = tok.refresh_token
  conn.access_expires_at = new Date(Date.now() + tok.expires_in * 1000).toISOString()
  return tok.access_token
}

async function getAccessToken(sb: SupabaseClient, conn: Connection): Promise<string> {
  const msLeft = new Date(conn.access_expires_at).getTime() - Date.now()
  if (msLeft > 2 * 60 * 1000) return conn.access_token
  return await refreshAccessToken(sb, conn)
}

// ---------------------------------------------------------------------------
// QuickBooks API
// ---------------------------------------------------------------------------
const MINOR_VERSION = 75

// deno-lint-ignore no-explicit-any
export async function qbo(sb: SupabaseClient, conn: Connection, path: string): Promise<any> {
  const sep = path.includes('?') ? '&' : '?'
  const url = `${apiBase(conn.environment)}/v3/company/${conn.realm_id}/${path}${sep}minorversion=${MINOR_VERSION}`

  const doFetch = (token: string) =>
    fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } })

  let res = await doFetch(await getAccessToken(sb, conn))
  if (res.status === 401) res = await doFetch(await refreshAccessToken(sb, conn))
  if (!res.ok) throw new Error(`QuickBooks ${path} failed (${res.status}): ${await res.text()}`)
  return await res.json()
}

// deno-lint-ignore no-explicit-any
export async function qboQuery(sb: SupabaseClient, conn: Connection, query: string): Promise<any> {
  const data = await qbo(sb, conn, `query?query=${encodeURIComponent(query)}`)
  return data.QueryResponse ?? {}
}

// ---------------------------------------------------------------------------
// Mapping & persistence
// ---------------------------------------------------------------------------
// deno-lint-ignore no-explicit-any
export function mapCustomer(realmId: string, c: any) {
  return {
    id: String(c.Id),
    realm_id: realmId,
    display_name: c.DisplayName ?? c.CompanyName ?? `Customer ${c.Id}`,
    company_name: c.CompanyName ?? null,
    email: c.PrimaryEmailAddr?.Address ?? null,
    active: c.Active !== false,
    raw: c,
    synced_at: new Date().toISOString(),
  }
}

// deno-lint-ignore no-explicit-any
export function mapPayment(realmId: string, p: any) {
  // deno-lint-ignore no-explicit-any
  const linked = (p.Line ?? []).flatMap((line: any) =>
    // deno-lint-ignore no-explicit-any
    (line.LinkedTxn ?? []).map((t: any) => ({
      txn_type: t.TxnType,
      txn_id: t.TxnId,
      doc_number: t.DocNumber ?? null,
      amount: line.Amount ?? null,
    })),
  )
  return {
    id: String(p.Id),
    realm_id: realmId,
    customer_id: p.CustomerRef?.value ? String(p.CustomerRef.value) : null,
    customer_name: p.CustomerRef?.name ?? null,
    total_amount: Number(p.TotalAmt ?? 0),
    unapplied_amount: p.UnappliedAmt != null ? Number(p.UnappliedAmt) : null,
    currency: p.CurrencyRef?.value ?? null,
    txn_date: p.TxnDate ?? null,
    payment_method: p.PaymentMethodRef?.name ?? null,
    reference_number: p.PaymentRefNum ?? null,
    private_note: p.PrivateNote ?? null,
    linked_invoices: linked,
    qbo_created_at: p.MetaData?.CreateTime ?? null,
    qbo_updated_at: p.MetaData?.LastUpdatedTime ?? null,
    deleted: false,
    raw: p,
    updated_at: new Date().toISOString(),
  }
}

/** Pull every customer from QuickBooks into qbo_customers. Never touches the `tracked` flag. */
export async function syncCustomers(sb: SupabaseClient, conn: Connection): Promise<number> {
  const pageSize = 1000
  let start = 1
  let total = 0
  for (;;) {
    const qr = await qboQuery(
      sb,
      conn,
      `select * from Customer where Active in (true, false) startposition ${start} maxresults ${pageSize}`,
    )
    // deno-lint-ignore no-explicit-any
    const rows: any[] = qr.Customer ?? []
    if (rows.length === 0) break
    const { error } = await sb
      .from('qbo_customers')
      .upsert(rows.map((c) => mapCustomer(conn.realm_id, c)), { onConflict: 'id' })
    if (error) throw error
    total += rows.length
    if (rows.length < pageSize) break
    start += pageSize
  }
  return total
}

/** Make sure a customer row exists so the RLS join and the admin list work. */
async function ensureCustomer(sb: SupabaseClient, realmId: string, id: string | null, name: string | null) {
  if (!id) return
  const { error } = await sb
    .from('qbo_customers')
    .upsert({ id, realm_id: realmId, display_name: name ?? `Customer ${id}` }, { onConflict: 'id', ignoreDuplicates: true })
  if (error) throw error
}

// deno-lint-ignore no-explicit-any
export async function savePayment(sb: SupabaseClient, realmId: string, p: any): Promise<void> {
  const row = mapPayment(realmId, p)
  await ensureCustomer(sb, realmId, row.customer_id, row.customer_name)
  const { error } = await sb.from('qbo_payments').upsert(row, { onConflict: 'id' })
  if (error) throw error
}

export async function fetchAndSavePayment(sb: SupabaseClient, conn: Connection, paymentId: string): Promise<void> {
  const data = await qbo(sb, conn, `payment/${paymentId}`)
  if (!data.Payment) throw new Error(`Payment ${paymentId} not in response`)
  await savePayment(sb, conn.realm_id, data.Payment)
}

export async function markPaymentDeleted(sb: SupabaseClient, paymentId: string): Promise<void> {
  const { error } = await sb
    .from('qbo_payments')
    .update({ deleted: true, updated_at: new Date().toISOString() })
    .eq('id', paymentId)
  if (error) throw error
}

export async function fetchAndSaveCustomer(sb: SupabaseClient, conn: Connection, customerId: string): Promise<void> {
  const data = await qbo(sb, conn, `customer/${customerId}`)
  if (!data.Customer) return
  const { error } = await sb.from('qbo_customers').upsert(mapCustomer(conn.realm_id, data.Customer), { onConflict: 'id' })
  if (error) throw error
}

/** Backfill payments with a TxnDate in the last N days. */
export async function backfillPayments(sb: SupabaseClient, conn: Connection, days: number): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  const pageSize = 1000
  let start = 1
  let total = 0
  for (;;) {
    const qr = await qboQuery(
      sb,
      conn,
      `select * from Payment where TxnDate >= '${since}' orderby TxnDate desc startposition ${start} maxresults ${pageSize}`,
    )
    // deno-lint-ignore no-explicit-any
    const rows: any[] = qr.Payment ?? []
    if (rows.length === 0) break
    for (const p of rows) await savePayment(sb, conn.realm_id, p)
    total += rows.length
    if (rows.length < pageSize) break
    start += pageSize
  }
  return total
}

// ---------------------------------------------------------------------------
// Webhook signature
// ---------------------------------------------------------------------------
export async function verifyIntuitSignature(rawBody: string, signature: string | null): Promise<boolean> {
  if (!signature) return false
  const verifier = env('QBO_WEBHOOK_VERIFIER')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(verifier),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody)))
  let binary = ''
  for (const b of mac) binary += String.fromCharCode(b)
  const expected = btoa(binary)
  if (expected.length !== signature.length) return false
  let diff = 0
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return diff === 0
}
