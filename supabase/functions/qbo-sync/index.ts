// Admin-triggered sync: refresh the customer list and backfill recent payments.
//   POST { backfillDays?: number }  (default 90)
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import {
  CORS_HEADERS,
  HttpError,
  adminClient,
  backfillPayments,
  errorResponse,
  getConnection,
  json,
  requireAdmin,
  syncCustomers,
} from '../_shared/qbo.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    await requireAdmin(req)

    let backfillDays = 90
    try {
      const body = await req.json()
      if (typeof body?.backfillDays === 'number') backfillDays = Math.min(Math.max(body.backfillDays, 0), 730)
    } catch {
      // empty body is fine
    }

    const sb = adminClient()
    const conn = await getConnection(sb)
    const customers = await syncCustomers(sb, conn)
    const payments = backfillDays > 0 ? await backfillPayments(sb, conn, backfillDays) : 0
    return json({ customers, payments, backfillDays })
  } catch (err) {
    return errorResponse(err)
  }
})
