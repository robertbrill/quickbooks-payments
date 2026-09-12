// Intuit webhook receiver. Verifies the HMAC signature, acks immediately,
// then fetches each changed Payment/Customer and writes it to the database.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  adminClient,
  fetchAndSaveCustomer,
  fetchAndSavePayment,
  getConnection,
  markPaymentDeleted,
  verifyIntuitSignature,
} from '../_shared/qbo.ts'

interface Entity {
  name: string
  id: string
  operation: 'Create' | 'Update' | 'Delete' | 'Merge' | 'Void' | 'Emailed'
  lastUpdated: string
}
interface Notification {
  realmId: string
  dataChangeEvent?: { entities?: Entity[] }
}

async function processNotifications(notifications: Notification[]): Promise<void> {
  const sb = adminClient()
  for (const n of notifications) {
    let conn
    try {
      conn = await getConnection(sb, n.realmId)
    } catch {
      console.warn(`Webhook for unknown realm ${n.realmId}; ignoring`)
      continue
    }
    for (const e of n.dataChangeEvent?.entities ?? []) {
      try {
        if (e.name === 'Payment') {
          if (e.operation === 'Delete' || e.operation === 'Void') await markPaymentDeleted(sb, e.id)
          else await fetchAndSavePayment(sb, conn, e.id)
        } else if (e.name === 'Customer') {
          if (e.operation === 'Delete') {
            await sb.from('qbo_customers').update({ active: false }).eq('id', e.id)
          } else {
            await fetchAndSaveCustomer(sb, conn, e.id)
          }
        }
      } catch (err) {
        console.error(`Failed processing ${e.name} ${e.id} (${e.operation})`, err)
      }
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const rawBody = await req.text()
  const ok = await verifyIntuitSignature(rawBody, req.headers.get('intuit-signature'))
  if (!ok) return new Response('Invalid signature', { status: 401 })

  let payload: { eventNotifications?: Notification[] }
  try {
    payload = JSON.parse(rawBody)
  } catch {
    return new Response('Bad JSON', { status: 400 })
  }

  // Intuit wants a fast 200; do the QuickBooks API calls after responding.
  EdgeRuntime.waitUntil(
    processNotifications(payload.eventNotifications ?? []).catch((e) => console.error('webhook processing failed', e)),
  )
  return new Response('ok', { status: 200 })
})
