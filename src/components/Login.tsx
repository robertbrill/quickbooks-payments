import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    })
    setBusy(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand big">
          <span className="logo">$</span>
          <span>Payment Feed</span>
        </div>
        {sent ? (
          <p>Check your inbox. We sent a sign-in link to <strong>{email}</strong>.</p>
        ) : (
          <>
            <p className="muted">Sign in with your work email. We'll send you a magic link.</p>
            <input
              type="email"
              required
              autoFocus
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="primary" disabled={busy}>
              {busy ? 'Sending…' : 'Send sign-in link'}
            </button>
            {error && <p className="error">{error}</p>}
          </>
        )}
      </form>
    </div>
  )
}
