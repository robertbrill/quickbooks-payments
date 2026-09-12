import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { money, shortDate, timeAgo, type Customer, type Payment } from '../lib/types'

const LIMIT = 300

type SortKey = 'date' | 'client' | 'amount' | 'posted'
type SortDir = 'asc' | 'desc'

export default function Feed({ isAdmin }: { isAdmin: boolean }) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [tracked, setTracked] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<string>('all')
  const [sortKey, setSortKey] = useState<SortKey>('date')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [, tick] = useState(0)
  const firstLoad = useRef(true)

  const load = useCallback(async () => {
    const [{ data: p }, { data: c }] = await Promise.all([
      supabase
        .from('qbo_payments')
        .select('*')
        .order('received_at', { ascending: false })
        .limit(LIMIT),
      supabase.from('qbo_customers').select('*').eq('tracked', true).order('display_name'),
    ])
    setPayments((p as Payment[]) ?? [])
    setTracked((c as Customer[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Realtime: new/updated payments appear instantly; tracking changes trigger a reload.
  useEffect(() => {
    const channel = supabase
      .channel('payment-feed')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qbo_payments' }, (msg) => {
        if (msg.eventType === 'DELETE') {
          const id = (msg.old as { id?: string }).id
          if (id) setPayments((prev) => prev.filter((x) => x.id !== id))
          return
        }
        const row = msg.new as Payment
        if (row.deleted) {
          setPayments((prev) => prev.filter((x) => x.id !== row.id))
          return
        }
        setPayments((prev) => {
          const idx = prev.findIndex((x) => x.id === row.id)
          if (idx === -1) {
            setFresh((f) => new Set(f).add(row.id))
            setTimeout(() => setFresh((f) => { const n = new Set(f); n.delete(row.id); return n }), 8000)
            return [row, ...prev].slice(0, LIMIT)
          }
          const next = [...prev]
          next[idx] = row
          return next
        })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qbo_customers' }, () => load())
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          setLive('live')
          if (!firstLoad.current) load()
          firstLoad.current = false
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setLive('offline')
        }
      })
    return () => {
      supabase.removeChannel(channel)
    }
  }, [load])

  // Re-render "x min ago" labels once a minute.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])

  function toggleExpanded(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir(key === 'client' ? 'asc' : 'desc')
    }
  }

  const visible = useMemo(() => {
    const rows = filter === 'all' ? payments : payments.filter((p) => p.customer_id === filter)
    const dir = sortDir === 'asc' ? 1 : -1
    const byDate = (a: Payment, b: Payment) => (a.txn_date ?? '').localeCompare(b.txn_date ?? '')
    return [...rows].sort((a, b) => {
      let cmp = 0
      switch (sortKey) {
        case 'client':
          cmp = (a.customer_name ?? '').localeCompare(b.customer_name ?? '', undefined, { sensitivity: 'base' })
          if (cmp === 0) cmp = -byDate(a, b) // same client: newest first
          break
        case 'amount':
          cmp = Number(a.total_amount) - Number(b.total_amount)
          break
        case 'posted':
          cmp = a.received_at.localeCompare(b.received_at)
          break
        default:
          cmp = byDate(a, b)
          if (cmp === 0) cmp = a.received_at.localeCompare(b.received_at)
      }
      return cmp * dir
    })
  }, [payments, filter, sortKey, sortDir])

  const stats = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const monthStr = todayStr.slice(0, 7)
    let today = 0
    let month = 0
    for (const p of visible) {
      if (!p.txn_date) continue
      if (p.txn_date === todayStr) today += Number(p.total_amount)
      if (p.txn_date.startsWith(monthStr)) month += Number(p.total_amount)
    }
    return { today, month, count: visible.length }
  }, [visible])

  if (loading) return <div className="center muted">Loading payments…</div>

  if (tracked.length === 0) {
    return (
      <div className="empty card">
        <h2>No clients are being tracked yet</h2>
        <p className="muted">
          {isAdmin
            ? 'Head to the Admin tab, connect QuickBooks, and pick the clients whose payments the team should see.'
            : 'Ask an admin to pick which clients to track. Payments will show up here the moment they post in QuickBooks.'}
        </p>
      </div>
    )
  }

  const Th = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
    <th className={className} aria-sort={sortKey === k ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button className="th-btn" onClick={() => toggleSort(k)}>
        {label}
        <span className="sort-ind">{sortKey === k ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  )

  return (
    <div className="feed">
      <div className="feed-head">
        <div className="stats">
          <Stat label="Today" value={money(stats.today)} />
          <Stat label="This month" value={money(stats.month)} />
          <Stat label="Payments shown" value={String(stats.count)} />
        </div>
        <div className="controls">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All tracked clients ({tracked.length})</option>
            {tracked.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
              </option>
            ))}
          </select>
          <span className={`live ${live}`}>
            <span className="dot" />
            {live === 'live' ? 'Live' : live === 'connecting' ? 'Connecting…' : 'Reconnecting…'}
          </span>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="empty card">
          <h2>Waiting for the first payment</h2>
          <p className="muted">This page updates by itself. Nothing to refresh.</p>
        </div>
      ) : (
        <div className="card table-card">
          <table className="payments-table">
            <thead>
              <tr>
                <Th k="date" label="Date" />
                <Th k="client" label="Client" />
                <Th k="amount" label="Amount" className="num" />
                <th>Details</th>
                <Th k="posted" label="Posted" />
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const invoices = (p.linked_invoices ?? []).filter((i) => i.txn_type === 'Invoice')
                const summary = [
                  p.payment_method,
                  p.reference_number ? `Ref ${p.reference_number}` : null,
                  invoices.length ? invoices.map((i) => `Inv ${i.doc_number ?? i.txn_id}`).join(', ') : null,
                  p.private_note,
                ]
                  .filter(Boolean)
                  .join(' · ')
                const open = expanded.has(p.id)
                return (
                  <FragmentRow key={p.id}>
                    <tr
                      className={`${fresh.has(p.id) ? 'fresh' : ''} ${open ? 'open' : ''} clickable`}
                      onClick={() => toggleExpanded(p.id)}
                      aria-expanded={open}
                    >
                      <td className="nowrap">{shortDate(p.txn_date)}</td>
                      <td className="client">{p.customer_name ?? 'Unknown client'}</td>
                      <td className="num amount">{money(Number(p.total_amount), p.currency)}</td>
                      <td className="details">
                        <span className="chev">{open ? '▾' : '▸'}</span>
                        <span className="summary" title={summary}>{summary || <span className="muted">—</span>}</span>
                      </td>
                      <td className="nowrap muted" title={new Date(p.received_at).toLocaleString()}>
                        {timeAgo(p.received_at)}
                      </td>
                    </tr>
                    {open && (
                      <tr className="detail-row">
                        <td colSpan={5}>
                          <dl className="detail-grid">
                            <dt>Method</dt>
                            <dd>{p.payment_method ?? '—'}</dd>
                            <dt>Reference</dt>
                            <dd>{p.reference_number ?? '—'}</dd>
                            <dt>Invoices</dt>
                            <dd>
                              {invoices.length
                                ? invoices
                                    .map((i) =>
                                      `${i.doc_number ?? i.txn_id}${i.amount != null ? ` (${money(Number(i.amount), p.currency)})` : ''}`,
                                    )
                                    .join(', ')
                                : '—'}
                            </dd>
                            <dt>Unapplied</dt>
                            <dd>{p.unapplied_amount != null ? money(Number(p.unapplied_amount), p.currency) : '—'}</dd>
                            <dt>Memo</dt>
                            <dd className="memo">{p.private_note ?? '—'}</dd>
                            <dt>QuickBooks ID</dt>
                            <dd>{p.id}</dd>
                            <dt>Received</dt>
                            <dd>{new Date(p.received_at).toLocaleString()}</dd>
                          </dl>
                        </td>
                      </tr>
                    )}
                  </FragmentRow>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

const FragmentRow = Fragment

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  )
}
