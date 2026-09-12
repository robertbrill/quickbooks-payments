import { useState } from 'react'
import { supabase } from '../lib/supabase'

export default function SetPassword({ email, onDone }: { email: string; onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (password.length < 8) return setError('Use at least 8 characters.')
    if (password !== confirm) return setError("Passwords don't match.")
    setBusy(true)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) setError(error.message)
    else onDone()
  }

  return (
    <div className="center">
      <form className="card login" onSubmit={submit}>
        <div className="brand big">
          <span className="logo">B</span>
          <span>Brill Media</span>
        </div>
        <p className="muted">
          Choose a password for <strong>{email}</strong>.
        </p>
        <input
          type="password"
          required
          autoFocus
          autoComplete="new-password"
          placeholder="New password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <input
          type="password"
          required
          autoComplete="new-password"
          placeholder="Confirm password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <button className="primary" disabled={busy}>
          {busy ? 'Saving…' : 'Save password'}
        </button>
        {error && <p className="error">{error}</p>}
      </form>
    </div>
  )
}
