// Admin-only: create a user by email with a chosen role and send them an invite link.
//   POST { email: string, role: 'admin' | 'member' }
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { CORS_HEADERS, HttpError, adminClient, env, errorResponse, json, requireAdmin } from '../_shared/qbo.ts'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS })
  try {
    if (req.method !== 'POST') throw new HttpError(405, 'Method not allowed')
    const { userId: adminId } = await requireAdmin(req, 'manage_users')

    const body = await req.json().catch(() => ({}))
    const email = String(body?.email ?? '').trim().toLowerCase()
    const role = body?.role === 'admin' ? 'admin' : 'member'
    if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address')

    const sb = adminClient()
    let userId: string | null = null
    let existing = false

    const { data, error } = await sb.auth.admin.inviteUserByEmail(email, { redirectTo: env('APP_URL') })
    if (!error) {
      userId = data.user.id
    } else if (error.code === 'email_exists' || /already|registered|exists/i.test(error.message)) {
      // Already has an account (maybe from the other app in this project). Find them and just set the role.
      existing = true
      for (let page = 1; page <= 20 && !userId; page++) {
        const { data: list, error: listErr } = await sb.auth.admin.listUsers({ page, perPage: 200 })
        if (listErr) throw listErr
        const hit = list.users.find((u) => u.email?.toLowerCase() === email)
        if (hit) userId = hit.id
        if (list.users.length < 200) break
      }
      if (!userId) throw new HttpError(404, 'That email is registered but could not be looked up')
    } else {
      throw new HttpError(400, error.message)
    }

    const { error: upsertErr } = await sb.from('qbo_team').upsert(
      { id: userId, email, role, invited_at: new Date().toISOString(), invited_by: adminId },
      { onConflict: 'id' },
    )
    if (upsertErr) throw upsertErr

    return json({ userId, role, existing })
  } catch (err) {
    return errorResponse(err)
  }
})
