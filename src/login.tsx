import { useEffect, useState } from 'react'
import { LockKeyhole, RadioTower } from 'lucide-react'
import { api, type AuthState } from './lib'

export function useAuth() {
  const [auth, setAuth] = useState<AuthState | null>(null)
  const refresh = () => api<AuthState>('/api/auth').then(setAuth).catch(() => setAuth({ enabled: false, authenticated: false, role: null, seededDefault: false }))
  useEffect(() => {
    void refresh()
    const required = () => setAuth((value) => value ? { ...value, authenticated: false, role: null } : value)
    window.addEventListener('u5g-auth-required', required)
    return () => window.removeEventListener('u5g-auth-required', required)
  }, [])
  return { auth, refresh, needsLogin: Boolean(auth?.enabled && !auth.authenticated) }
}

export function Login({ seededDefault, onSuccess }: { seededDefault?: boolean; onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      await api('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })
      onSuccess()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }
  return <main className="login-screen">
    <form className="login-card" onSubmit={submit}>
      <div className="login-logo"><RadioTower size={30} /></div>
      <span className="eyebrow">Local operations console</span>
      <h1>UniFi U5G Monitor</h1>
      <p>Sign in to access the modem, SMS messages and automations.</p>
      <label className="input-with-icon"><LockKeyhole size={16} /><input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" /></label>
      {error && <div className="notice danger">{error}</div>}
      <button className="btn primary" disabled={busy || !password}>{busy ? 'Signing in…' : 'Sign in'}</button>
      {seededDefault && <small>Default password is <code>admin</code>. Change it in Settings.</small>}
    </form>
  </main>
}
