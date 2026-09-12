import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { TeamMember } from './lib/types'
import Login from './components/Login'
import Feed from './components/Feed'
import Admin from './components/Admin'

type Tab = 'feed' | 'admin'

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [me, setMe] = useState<TeamMember | null>(null)
  const [tab, setTab] = useState<Tab>('feed')
  const [banner, setBanner] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) {
      setMe(null)
      return
    }
    supabase
      .from('qbo_team')
      .select('*')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(({ data }) => setMe(data as TeamMember | null))
  }, [session])

  // Handle ?qbo=connected / ?qbo=error after the QuickBooks OAuth redirect.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const qbo = params.get('qbo')
    if (!qbo) return
    if (qbo === 'connected') {
      setBanner('QuickBooks connected. Customers are syncing now.')
      setTab('admin')
    } else {
      setBanner(`QuickBooks connection failed: ${params.get('message') ?? 'unknown error'}`)
    }
    window.history.replaceState({}, '', window.location.pathname)
  }, [])

  if (session === undefined) return <div className="center muted">Loading…</div>
  if (!session) return <Login />

  const isAdmin = me?.role === 'admin'

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">$</span>
          <span>Payment Feed</span>
        </div>
        {isAdmin && (
          <nav className="tabs">
            <button className={tab === 'feed' ? 'active' : ''} onClick={() => setTab('feed')}>
              Feed
            </button>
            <button className={tab === 'admin' ? 'active' : ''} onClick={() => setTab('admin')}>
              Admin
            </button>
          </nav>
        )}
        <div className="user">
          <span className="muted">{session.user.email}</span>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      {banner && (
        <div className="banner">
          <span>{banner}</span>
          <button className="ghost" onClick={() => setBanner(null)}>
            ×
          </button>
        </div>
      )}

      <main>{tab === 'admin' && isAdmin ? <Admin /> : <Feed isAdmin={isAdmin} />}</main>
    </div>
  )
}
