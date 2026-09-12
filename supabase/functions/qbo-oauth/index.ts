// QuickBooks OAuth.
//   POST  (signed-in admin)  -> { url } to send the browser to Intuit
//   GET   ?code&state&realmId (Intuit redirect) -> stores tokens, syncs customers, redirects to APP_URL
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  AUTH_URL,
  CORS_HEADERS,
  HttpError,
  QBO_ENVIRONMENT,
  SCOPE,
  adminClient,
  env,
  errorResponse,
  exchangeToken,
  getConnection,
  json,
  oauthRedirectUri,
  qbo,
  requireAdmin,
  saveTokens,
  syncCustomers,
} from '../_shared/qbo.ts'

const STATE_TTL_MS = 15 * 60 * 1000

function redirect(to: string): Response {
  return new Response(null, { status: 302, headers: { Location: to } })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })

  try {
    if (req.method === 'POST') {
      const { userId } = await requireAdmin(req, 'manage_quickbooks')
      const sb = adminClient()
      const state = crypto.randomUUID()

      await sb.from('qbo_oauth_states').delete().lt('created_at', new Date(Date.now() - STATE_TTL_MS).toISOString())
      const { error } = await sb.from('qbo_oauth_states').insert({ state, user_id: userId })
      if (error) throw error

      const url = new URL(AUTH_URL)
      url.searchParams.set('client_id', env('QBO_CLIENT_ID'))
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('scope', SCOPE)
      url.searchParams.set('redirect_uri', oauthRedirectUri())
      url.searchParams.set('state', state)
      return json({ url: url.toString() })
    }

    if (req.method === 'GET') {
      const appUrl = env('APP_URL')
      const params = new URL(req.url).searchParams
      const oauthError = params.get('error')
      if (oauthError) return redirect(`${appUrl}?qbo=error&message=${encodeURIComponent(oauthError)}`)

      const code = params.get('code')
      const state = params.get('state')
      const realmId = params.get('realmId')
      if (!code || !state || !realmId) throw new HttpError(400, 'Missing code, state, or realmId')

      const sb = adminClient()
      const { data: st } = await sb.from('qbo_oauth_states').select('*').eq('state', state).maybeSingle()
      if (!st || Date.now() - new Date(st.created_at).getTime() > STATE_TTL_MS) {
        throw new HttpError(400, 'OAuth state is invalid or expired. Start the connection again.')
      }
      await sb.from('qbo_oauth_states').delete().eq('state', state)

      const tok = await exchangeToken({ grant_type: 'authorization_code', code, redirect_uri: oauthRedirectUri() })
      await saveTokens(sb, realmId, tok, { environment: QBO_ENVIRONMENT, connected_by: st.user_id })

      const conn = await getConnection(sb, realmId)
      try {
        const info = await qbo(sb, conn, `companyinfo/${realmId}`)
        await sb
          .from('qbo_connections')
          .update({ company_name: info.CompanyInfo?.CompanyName ?? null })
          .eq('realm_id', realmId)
      } catch (e) {
        console.warn('Could not read company info', e)
      }

      // Pull the customer list in the background so the admin can start picking clients.
      EdgeRuntime.waitUntil(syncCustomers(sb, conn).catch((e) => console.error('customer sync failed', e)))

      return redirect(`${appUrl}?qbo=connected`)
    }

    throw new HttpError(405, 'Method not allowed')
  } catch (err) {
    return errorResponse(err)
  }
})
