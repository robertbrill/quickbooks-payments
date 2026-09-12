import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { ROLE_LABELS, shortDate, timeAgo, type ConnectionStatus, type Customer, type Role, type TeamMember, type UserApp } from '../lib/types'
import { APPS } from '../apps'

export default function Admin() {
  return (
    <div className="admin">
      <TeamCard />
      <AppsCard />
      <ConnectionCard />
      <ClientsCard />
    </div>
  )
}

function ConnectionCard() {
  const [conn, setConn] = useState<ConnectionStatus | null | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    const { data } = await supabase.rpc('qbo_connection_status')
    setConn(((data as ConnectionStatus[] | null) ?? [])[0] ?? null)
  }
  useEffect(() => {
    load()
  }, [])

  async function connect() {
    setBusy('connect')
    setMsg(null)
    const { data, error } = await supabase.functions.invoke('qbo-oauth', { body: {} })
    setBusy(null)
    if (error || !data?.url) {
      setMsg(error?.message ?? 'Could not start the QuickBooks connection')
      return
    }
    window.location.href = data.url
  }

  async function sync(days: number) {
    setBusy('sync')
    setMsg(null)
    const { data, error } = await supabase.functions.invoke('qbo-sync', { body: { backfillDays: days } })
    setBusy(null)
    if (error) setMsg(error.message)
    else setMsg(`Synced ${data.customers} customers and ${data.payments} payments from the last ${data.backfillDays} days.`)
    load()
  }

  const refreshDaysLeft = conn ? Math.floor((new Date(conn.refresh_expires_at).getTime() - Date.now()) / 86_400_000) : null

  return (
    <section className="card">
      <div className="card-head">
        <h2>QuickBooks</h2>
        {conn && <span className={`pill ${conn.environment}`}>{conn.environment}</span>}
      </div>
      {conn === undefined ? (
        <p className="muted">Checking connection…</p>
      ) : conn ? (
        <>
          <p>
            Connected to <strong>{conn.company_name ?? `company ${conn.realm_id}`}</strong>.{' '}
            <span className="muted">
              Last token refresh {shortDate(conn.updated_at)}.{' '}
              {refreshDaysLeft !== null && refreshDaysLeft < 14
                ? `Reconnect within ${refreshDaysLeft} days or the link will expire.`
                : `Link valid for ${refreshDaysLeft} more days.`}
            </span>
          </p>
          <div className="row">
            <button onClick={() => sync(90)} disabled={!!busy}>
              {busy === 'sync' ? 'Syncing…' : 'Sync customers + last 90 days'}
            </button>
            <button onClick={() => sync(0)} disabled={!!busy}>
              Sync customers only
            </button>
            <button className="ghost" onClick={connect} disabled={!!busy}>
              Reconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Connect your QuickBooks Online company to start receiving payments.</p>
          <button className="primary" onClick={connect} disabled={!!busy}>
            {busy === 'connect' ? 'Opening Intuit…' : 'Connect QuickBooks'}
          </button>
        </>
      )}
      {msg && <p className="note">{msg}</p>}
    </section>
  )
}

function ClientsCard() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [loading, setLoading] = useState(true)

  async function load() {
    const { data } = await supabase.from('qbo_customers').select('*').order('display_name')
    setCustomers((data as Customer[]) ?? [])
    setLoading(false)
  }
  useEffect(() => {
    load()
    const ch = supabase
      .channel('admin-customers')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qbo_customers' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  async function toggle(c: Customer) {
    setCustomers((prev) => prev.map((x) => (x.id === c.id ? { ...x, tracked: !c.tracked } : x)))
    const { error } = await supabase.from('qbo_customers').update({ tracked: !c.tracked }).eq('id', c.id)
    if (error) {
      alert(error.message)
      load()
    }
  }

  const trackedCount = customers.filter((c) => c.tracked).length
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return customers.filter(
      (c) =>
        (showInactive || c.active || c.tracked) &&
        (!needle ||
          c.display_name.toLowerCase().includes(needle) ||
          (c.company_name ?? '').toLowerCase().includes(needle) ||
          (c.email ?? '').toLowerCase().includes(needle)),
    )
  }, [customers, q, showInactive])

  return (
    <section className="card">
      <div className="card-head">
        <h2>Clients to track</h2>
        <span className="muted">
          {trackedCount} of {customers.length} tracked
        </span>
      </div>
      <p className="muted">The team only sees payments from clients you check here.</p>
      <div className="row">
        <input placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
      </div>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : customers.length === 0 ? (
        <p className="muted">No customers yet. Connect QuickBooks or run a sync.</p>
      ) : (
        <ul className="clients">
          {visible.map((c) => (
            <li key={c.id} className={c.tracked ? 'tracked' : ''}>
              <label>
                <input type="checkbox" checked={c.tracked} onChange={() => toggle(c)} />
                <span className="client-name">
                  {c.display_name}
                  {!c.active && <span className="pill inactive">inactive</span>}
                </span>
                <span className="muted small">{c.email ?? c.company_name ?? ''}</span>
              </label>
            </li>
          ))}
          {visible.length === 0 && <li className="muted">No matches.</li>}
        </ul>
      )}
    </section>
  )
}

function AppsCard() {
  const grantable = APPS.filter((a) => !a.adminOnly)
  const [team, setTeam] = useState<TeamMember[]>([])
  const [grants, setGrants] = useState<Set<string>>(new Set()) // "userId:appKey"
  const [loading, setLoading] = useState(true)

  async function load() {
    const [{ data: t }, { data: g }] = await Promise.all([
      supabase.from('qbo_team').select('*').order('created_at'),
      supabase.from('qbo_user_apps').select('user_id, app_key'),
    ])
    setTeam((t as TeamMember[]) ?? [])
    setGrants(new Set(((g as UserApp[]) ?? []).map((r) => `${r.user_id}:${r.app_key}`)))
    setLoading(false)
  }
  useEffect(() => {
    load()
    const ch = supabase
      .channel('admin-apps')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qbo_user_apps' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qbo_team' }, () => load())
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
  }, [])

  async function toggle(userId: string, appKey: string, on: boolean) {
    const key = `${userId}:${appKey}`
    setGrants((prev) => {
      const next = new Set(prev)
      if (on) next.add(key)
      else next.delete(key)
      return next
    })
    const { error } = on
      ? await supabase.from('qbo_user_apps').insert({ user_id: userId, app_key: appKey })
      : await supabase.from('qbo_user_apps').delete().eq('user_id', userId).eq('app_key', appKey)
    if (error) {
      alert(error.message)
      load()
    }
  }

  const people = team.filter((m) => m.role !== 'blocked')

  return (
    <section className="card">
      <div className="card-head">
        <h2>App access</h2>
        <span className="muted">{grantable.length} app{grantable.length === 1 ? '' : 's'}</span>
      </div>
      <p className="muted">
        Tick the apps each person should see on their home screen. Admins automatically see everything.
      </p>
      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="table-wrap">
          <table className="access-table">
            <thead>
              <tr>
                <th>Person</th>
                {grantable.map((a) => (
                  <th key={a.key} className="center-col">
                    {a.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {people.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div>{m.email}</div>
                    <div className="muted small">{ROLE_LABELS[m.role]}</div>
                  </td>
                  {grantable.map((a) => (
                    <td key={a.key} className="center-col">
                      {m.role === 'admin' ? (
                        <span className="muted small" title="Admins see every app">all</span>
                      ) : (
                        <input
                          type="checkbox"
                          checked={grants.has(`${m.id}:${a.key}`)}
                          onChange={(e) => toggle(m.id, a.key, e.target.checked)}
                          aria-label={`${a.title} for ${m.email}`}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
              {people.length === 0 && (
                <tr>
                  <td colSpan={grantable.length + 1} className="muted">
                    No users yet. Add someone above.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function TeamCard() {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [meId, setMeId] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  async function load() {
    const [{ data }, { data: auth }] = await Promise.all([
      supabase.from('qbo_team').select('*').order('created_at'),
      supabase.auth.getUser(),
    ])
    setTeam((data as TeamMember[]) ?? [])
    setMeId(auth.user?.id ?? null)
  }
  useEffect(() => {
    load()
  }, [])

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(null)
    const { data, error } = await supabase.functions.invoke('qbo-invite', { body: { email, role } })
    setBusy(false)
    if (error) {
      let detail = error.message
      try {
        const ctx = (error as { context?: Response }).context
        if (ctx) detail = (await ctx.json()).error ?? detail
      } catch {
        // keep generic message
      }
      setMsg(detail)
      return
    }
    setMsg(
      data.existing
        ? `${email} already had an account, so no email was sent. Their role is now ${ROLE_LABELS[data.role as Role]}. Use Send password link if they need to set one.`
        : `Invite sent to ${email} as ${ROLE_LABELS[data.role as Role]}. They'll choose a password when they open it.`,
    )
    setEmail('')
    load()
  }

  async function sendPasswordLink(m: TeamMember) {
    if (!m.email) return
    setMsg(null)
    const { error } = await supabase.auth.resetPasswordForEmail(m.email, { redirectTo: window.location.origin })
    setMsg(error ? error.message : `Password link sent to ${m.email}.`)
  }

  async function changeRole(m: TeamMember, next: Role) {
    const { error } = await supabase.from('qbo_team').update({ role: next }).eq('id', m.id)
    if (error) alert(error.message)
    load()
  }

  function status(m: TeamMember) {
    if (m.role === 'blocked') return 'blocked'
    if (m.last_seen_at) return `active · seen ${timeAgo(m.last_seen_at)}`
    if (m.invited_at) return `invited ${shortDate(m.invited_at)} · not signed in yet`
    return 'not signed in yet'
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Users</h2>
        <span className="muted">{team.filter((m) => m.role !== 'blocked').length} with access</span>
      </div>
      <p className="muted">
        <strong>Admins</strong> connect QuickBooks, choose clients, and manage users. <strong>Users</strong> see only
        the apps they're granted. Blocked people can't get in.
      </p>

      <form className="row invite" onSubmit={invite}>
        <input
          type="email"
          required
          placeholder="teammate@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="member">User</option>
          <option value="admin">Admin</option>
        </select>
        <button className="primary" disabled={busy || !email}>
          {busy ? 'Sending…' : 'Add user'}
        </button>
      </form>
      {msg && <p className="note">{msg}</p>}

      <ul className="team">
        {team.map((m) => (
          <li key={m.id} className={m.role === 'blocked' ? 'muted' : ''}>
            <span>
              <div>
                {m.email} {m.id === meId && <span className="muted small">(you)</span>}
              </div>
              <div className="muted small">{status(m)}</div>
            </span>
            <span className="row">
              <button className="ghost small" onClick={() => sendPasswordLink(m)} disabled={m.role === 'blocked'}>
                Send password link
              </button>
              <select value={m.role} disabled={m.id === meId} onChange={(e) => changeRole(m, e.target.value as Role)}>
                <option value="member">User</option>
                <option value="admin">Admin</option>
                <option value="blocked">Blocked</option>
              </select>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
