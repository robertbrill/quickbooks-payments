import { useEffect, useState } from 'react'
import { BrowserRouter, Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { TeamMember } from './lib/types'
import Landing from './components/Landing'
import Login from './components/Login'
import Home from './components/Home'
import Feed from './components/Feed'
import Admin from './components/Admin'

export default function App() {
  return (
    <BrowserRouter>
      <Shell />
    </BrowserRouter>
  )
}

function Shell() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [me, setMe] = useState<TeamMember | null>(null)
  const [banner, setBanner] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

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
    supabase.rpc('qbo_join').then(({ data, error }) => {
      if (error) console.error('qbo_join failed', error)
      setMe((data as TeamMember | null) ?? null)
    })
  }, [session])

  // Handle ?qbo=connected / ?qbo=error after the QuickBooks OAuth redirect.
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const qbo = params.get('qbo')
    if (!qbo) return
    if (qbo === 'connected') setBanner('QuickBooks connected. Customers are syncing now.')
    else setBanner(`QuickBooks connection failed: ${params.get('message') ?? 'unknown error'}`)
    navigate('/admin', { replace: true })
  }, [location.search, navigate])

  if (session === undefined) return <div className="center muted">Loading…</div>

  if (!session) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Landing />} />
      </Routes>
    )
  }

  const isAdmin = me?.role === 'admin'

  if (me && me.role === 'blocked') {
    return (
      <div className="center">
        <div className="card empty">
          <h2>No access</h2>
          <p className="muted">Your account has been blocked. Ask an admin to restore it.</p>
          <button className="ghost" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="logo">B</span>
          <span>Brill Media</span>
        </Link>
        <nav className="tabs">
          <NavLink to="/" end>
            Home
          </NavLink>
          <NavLink to="/payments">Payments</NavLink>
          {isAdmin && <NavLink to="/admin">Settings</NavLink>}
        </nav>
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

      <main>
        <Routes>
          <Route path="/" element={<Home me={me} email={session.user.email ?? ''} />} />
          <Route path="/payments" element={<Feed isAdmin={isAdmin} />} />
          <Route path="/admin" element={isAdmin ? <Admin /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
