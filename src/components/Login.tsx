import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'password' | 'forgot'>('password')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    setBusy(false)
    if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
  }

  async function sendReset(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  if (mode === 'forgot') {
    return (
      <div className="center">
        <form className="card login" onSubmit={sendReset}>
          <div className="brand big">
            <span className="logo">B</span>
            <span>Brill Media</span>
          </div>
          {sent ? (
            <p>
              Check your inbox. We sent a link to <strong>{email}</strong> to set a new password.
            </p>
          ) : (
            <>
              <p className="muted">Enter your email and we'll send a link to set a new password.</p>
              <input
                type="email"
                required
                autoFocus
                placeholder="Email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
              <button className="primary" disabled={busy}>
                {busy ? 'Sending…' : 'Send link'}
              </button>
              {error && <p className="error">{error}</p>}
            </>
          )}
          <button type="button" className="ghost small" onClick={() => { setMode('password'); setSent(false); setError(null) }}>
            ← Back to sign in
          </button>
        </form>
      </div>
    )
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={signIn}>
        <div className="brand big">
          <span className="logo">B</span>
          <span>Brill Media</span>
        </div>
        <input
          type="email"
          required
          autoFocus
          autoComplete="username"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="primary" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <p className="error">{error}</p>}
        <button type="button" className="ghost small" onClick={() => { setMode('forgot'); setError(null) }}>
          Forgot password?
        </button>
      </form>
    </div>
  )
}
