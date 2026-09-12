import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { shortDate, type ConnectionStatus, type Customer, type Role, type TeamMember } from '../lib/types'

export default function Admin() {
  return (
    <div className="admin">
      <ConnectionCard />
      <ClientsCard />
      <TeamCard />
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

function TeamCard() {
  const [team, setTeam] = useState<TeamMember[]>([])
  const [meId, setMeId] = useState<string | null>(null)

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

  async function setRole(m: TeamMember, role: Role) {
    const { error } = await supabase.from('qbo_team').update({ role }).eq('id', m.id)
    if (error) alert(error.message)
    load()
  }

  return (
    <section className="card">
      <div className="card-head">
        <h2>Team</h2>
        <span className="muted">{team.filter((m) => m.role !== 'blocked').length} with access</span>
      </div>
      <p className="muted">
        Anyone who signs in with a magic link gets member access. Promote admins here, or block people who shouldn't
        see the feed.
      </p>
      <ul className="team">
        {team.map((m) => (
          <li key={m.id} className={m.role === 'blocked' ? 'muted' : ''}>
            <span>
              {m.email} {m.id === meId && <span className="muted small">(you)</span>}
            </span>
            <select value={m.role} disabled={m.id === meId} onChange={(e) => setRole(m, e.target.value as Role)}>
              <option value="member">member</option>
              <option value="admin">admin</option>
              <option value="blocked">blocked (no access)</option>
            </select>
          </li>
        ))}
      </ul>
    </section>
  )
}
