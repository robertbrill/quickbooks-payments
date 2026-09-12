import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { money, shortDate, timeAgo, type Customer, type Payment } from '../lib/types'

const LIMIT = 300

export default function Feed({ isAdmin }: { isAdmin: boolean }) {
  const [payments, setPayments] = useState<Payment[]>([])
  const [tracked, setTracked] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [live, setLive] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [fresh, setFresh] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState<string>('all')
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
            // Brand new payment: flash it.
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
          // Catch anything that landed while we were disconnected.
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

  const visible = useMemo(
    () => (filter === 'all' ? payments : payments.filter((p) => p.customer_id === filter)),
    [payments, filter],
  )

  const stats = useMemo(() => {
    const now = new Date()
    const todayStr = now.toISOString().slice(0, 10)
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
        <ul className="payments">
          {visible.map((p) => (
            <li key={p.id} className={`payment card ${fresh.has(p.id) ? 'fresh' : ''}`}>
              <div className="payment-main">
                <div className="payment-client">{p.customer_name ?? 'Unknown client'}</div>
                <div className="payment-meta muted">
                  {shortDate(p.txn_date)}
                  {p.payment_method && <> · {p.payment_method}</>}
                  {p.reference_number && <> · Ref {p.reference_number}</>}
                  {p.linked_invoices && p.linked_invoices.length > 0 && (
                    <>
                      {' · '}
                      {p.linked_invoices
                        .filter((i) => i.txn_type === 'Invoice')
                        .map((i) => `Inv ${i.doc_number ?? i.txn_id}`)
                        .join(', ')}
                    </>
                  )}
                </div>
                {p.private_note && <div className="payment-note muted">{p.private_note}</div>}
              </div>
              <div className="payment-right">
                <div className="payment-amount">{money(Number(p.total_amount), p.currency)}</div>
                <div className="muted small" title={new Date(p.received_at).toLocaleString()}>
                  posted {timeAgo(p.received_at)}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="stat">
      <div className="muted small">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  )
}
