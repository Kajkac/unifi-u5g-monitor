import { useState } from 'react'
import { KeyRound, LockKeyhole, Server } from 'lucide-react'
import { api } from './lib'
import { UNIFI_LOGO } from './brand'

export function Setup({ onSuccess, onSkip }: { onSuccess: () => void; onSkip: () => void }) {
  const [gatewayHost, setGatewayHost] = useState('')
  const [gatewayUser, setGatewayUser] = useState('root')
  const [gatewayPassword, setGatewayPassword] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    if (adminPassword !== confirmPassword) { setError('Passwords do not match.'); return }
    setBusy(true)
    try {
      await api('/api/setup', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ gatewayHost, gatewayUser, gatewayPassword, adminPassword }) })
      await api('/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: adminPassword }) })
      onSuccess()
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)) } finally { setBusy(false) }
  }

  return <main className="login-screen">
    <form className="login-card setup-card" onSubmit={submit}>
      <div className="login-logo"><img src={UNIFI_LOGO} alt="UniFi" /></div>
      <span className="eyebrow">First-time setup</span>
      <h1>UniFi U5G Monitor</h1>
      <p>Connect your UniFi gateway and set an admin password to get started.</p>

      <label className="input-with-icon"><Server size={16} /><input autoFocus value={gatewayHost} onChange={(e) => setGatewayHost(e.target.value)} placeholder="Gateway IP (e.g. 192.168.1.1)" required /></label>
      <div className="setup-row">
        <label className="input-with-icon"><Server size={16} /><input value={gatewayUser} onChange={(e) => setGatewayUser(e.target.value)} placeholder="SSH username" required /></label>
        <label className="input-with-icon"><LockKeyhole size={16} /><input type="password" value={gatewayPassword} onChange={(e) => setGatewayPassword(e.target.value)} placeholder="Gateway SSH password" required /></label>
      </div>
      <div className="setup-row">
        <label className="input-with-icon"><KeyRound size={16} /><input type="password" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} placeholder="New admin password" minLength={4} required /></label>
        <label className="input-with-icon"><KeyRound size={16} /><input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm password" minLength={4} required /></label>
      </div>

      {error && <div className="notice danger">{error}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Setting up…' : 'Finish setup'}</button>
      <small>You can change the modem, MQTT, and notification settings later. <button type="button" className="text-btn" onClick={onSkip}>Skip for now</button></small>
    </form>
  </main>
}
