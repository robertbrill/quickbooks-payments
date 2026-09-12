import { useEffect, useRef, useState } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { authLinkType, supabase } from './lib/supabase'
import type { TeamMember, UserApp } from './lib/types'
import { APPS } from './apps'
import Login from './components/Login'
import SetPassword from './components/SetPassword'
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

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="empty card">
      <h2>{title}</h2>
      <p className="muted">This app isn't linked up yet.</p>
    </div>
  )
}

function ProfileMenu({ email, isAdmin }: { email: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => setOpen(false), [location.pathname])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const initial = (email[0] ?? '?').toUpperCase()

  return (
    <div className="profile" ref={ref}>
      <button
        className="avatar"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={email}
      >
        {initial}
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-email muted small">{email}</div>
          {isAdmin && (
            <Link to="/admin" className="menu-item" role="menuitem">
              Settings
            </Link>
          )}
          <button className="menu-item" role="menuitem" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}

function Shell() {
  const [session, setSession] = useState<Session | null | undefined>(undefined)
  const [me, setMe] = useState<TeamMember | null>(null)
  const [myApps, setMyApps] = useState<Set<string>>(new Set())
  const [needsPassword, setNeedsPassword] = useState(authLinkType === 'invite' || authLinkType === 'recovery')
  const [banner, setBanner] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setNeedsPassword(true)
      setSession(s)
    })
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

    const uid = session.user.id
    const loadApps = async () => {
      const { data } = await supabase.from('qbo_user_apps').select('app_key').eq('user_id', uid)
      setMyApps(new Set(((data as Pick<UserApp, 'app_key'>[] | null) ?? []).map((r) => r.app_key)))
    }
    loadApps()
    const ch = supabase
      .channel(`my-apps-${uid}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'qbo_user_apps', filter: `user_id=eq.${uid}` }, () => loadApps())
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'qbo_team', filter: `id=eq.${uid}` }, (msg) =>
        setMe(msg.new as TeamMember),
      )
      .subscribe()
    return () => {
      supabase.removeChannel(ch)
    }
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
        <Route path="*" element={<Login />} />
      </Routes>
    )
  }

  if (needsPassword) {
    return <SetPassword email={session.user.email ?? ''} onDone={() => { setNeedsPassword(false); navigate('/', { replace: true }) }} />
  }

  const isAdmin = me?.role === 'admin'
  const canUse = (key: string) => isAdmin || myApps.has(key)
  const allowed = APPS.filter((app) => (app.adminOnly ? isAdmin : canUse(app.key)))

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
        <ProfileMenu email={session.user.email ?? ''} isAdmin={isAdmin} />
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
          <Route path="/" element={<Home apps={allowed.filter((a) => !a.adminOnly)} email={session.user.email ?? ''} />} />
          <Route path="/payments" element={canUse('payments') ? <Feed isAdmin={isAdmin} /> : <Navigate to="/" replace />} />
          {APPS.filter((a) => a.to.startsWith('/apps/')).map((a) => (
            <Route
              key={a.key}
              path={a.to}
              element={canUse(a.key) ? <ComingSoon title={a.title} /> : <Navigate to="/" replace />}
            />
          ))}
          <Route path="/admin" element={isAdmin ? <Admin /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
