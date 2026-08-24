import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Activity, Antenna, ArrowDownUp, Bot, Clock3, Command, Database, Gauge, LogOut, MessageSquare, Moon, RadioTower, RefreshCw, Settings, Signal, Sun, Terminal } from 'lucide-react'
import { UNIFI_LOGO } from './brand'
import { api, formatRelative, type EventRow, type Status, type TabId, type TrendPoint, useNow } from './lib'
import { Login, useAuth } from './login'
import { Setup } from './setup'
import { OverviewView, SignalView, DataView, SystemView, DiagnosticsView, MqttView } from './views'
import { SmsView } from './sms'
import { AutomationsView } from './automations'
import { TimelineView } from './timeline'
import { SettingsView } from './settings'
import './App.css'
import './diagnostics.css'

const nav: Array<{ id: TabId; label: string; icon: ReactNode; group: string }> = [
  { id: 'overview', label: 'Overview', icon: <Gauge size={18} />, group: 'Status' },
  { id: 'signal', label: 'Signal', icon: <Signal size={18} />, group: 'Connectivity' },
  { id: 'data', label: 'Data & WAN', icon: <ArrowDownUp size={18} />, group: 'Connectivity' },
  { id: 'sms', label: 'SMS', icon: <MessageSquare size={18} />, group: 'Messaging' },
  { id: 'automations', label: 'Automations', icon: <Bot size={18} />, group: 'Messaging' },
  { id: 'timeline', label: 'Timeline', icon: <Clock3 size={18} />, group: 'System' },
  { id: 'system', label: 'System', icon: <Database size={18} />, group: 'System' },
  { id: 'diagnostics', label: 'Diagnostics', icon: <Terminal size={18} />, group: 'System' },
  { id: 'mqtt', label: 'MQTT', icon: <RadioTower size={18} />, group: 'System' },
  { id: 'settings', label: 'Settings', icon: <Settings size={18} />, group: 'Configuration' },
]

function hashTab(): TabId {
  const value = location.hash.replace('#', '') as TabId
  return nav.some((item) => item.id === value) ? value : 'overview'
}

export default function App() {
  const auth = useAuth()
  const authenticated = auth.auth?.authenticated ?? false
  const [tab, setTabState] = useState<TabId>(hashTab)
  const [status, setStatus] = useState<Status | null>(null)
  const [history, setHistory] = useState<TrendPoint[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [live, setLive] = useState(false)
  const [busy, setBusy] = useState(false)
  const [theme, setTheme] = useState(() => localStorage.getItem('u5g-theme') || 'dark')
  const [toasts, setToasts] = useState<Array<{ id: number; tone: string; text: string }>>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [skipSetup, setSkipSetup] = useState(false)
  const socketRef = useRef<WebSocket | null>(null)
  const toastId = useRef(0)
  const now = useNow()
  const viewer = auth.auth?.role === 'viewer'

  function setTab(next: TabId) { location.hash = next; setTabState(next) }
  function notify(tone: string, text: string) {
    const id = ++toastId.current
    setToasts((current) => [...current.slice(-3), { id, tone, text }])
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 5000)
  }
  async function reload() {
    const [next, trend, feed] = await Promise.all([api<Status>('/api/status'), api<TrendPoint[]>('/api/history?minutes=1440'), api<EventRow[]>('/api/events?limit=100')])
    setStatus(next); setHistory(trend); setEvents(feed)
  }
  async function refresh() {
    setBusy(true)
    try { setStatus(await api<Status>('/api/actions/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })); await reload() }
    catch (error) { notify('danger', error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }
  async function logout() { await api('/api/logout', { method: 'POST' }).catch(() => undefined); await auth.refresh() }

  useEffect(() => {
    if (auth.needsLogin || !authenticated) return
    void reload().catch(() => undefined)
    let closed = false
    let retry: ReturnType<typeof setTimeout>
    const connect = () => {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${location.host}/ws`)
      socketRef.current = socket
      socket.onopen = () => setLive(true)
      socket.onclose = () => { setLive(false); if (!closed) retry = setTimeout(connect, 3000) }
      socket.onmessage = (message) => {
        const payload = JSON.parse(message.data)
        if (payload.type === 'status') setStatus(payload.status)
        if (payload.type === 'event') {
          setEvents((current) => [...current.slice(-99), payload.event])
          if (payload.event.level !== 'info') notify(payload.event.level === 'error' ? 'danger' : 'warn', payload.event.message)
        }
      }
    }
    connect()
    return () => { closed = true; clearTimeout(retry); socketRef.current?.close() }
  }, [auth.needsLogin, authenticated])

  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem('u5g-theme', theme) }, [theme])
  useEffect(() => { const fn = () => setTabState(hashTab()); window.addEventListener('hashchange', fn); return () => window.removeEventListener('hashchange', fn) }, [])
  useEffect(() => {
    const fn = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen((v) => !v) } }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [])
  const title = nav.find((item) => item.id === tab)?.label || 'Overview'
  const view = (() => {
    const common = { status, history, events, viewer, onRefresh: refresh, notify }
    if (tab === 'overview') return <OverviewView {...common} onNavigate={setTab} />
    if (tab === 'signal') return <SignalView {...common} />
    if (tab === 'data') return <DataView {...common} />
    if (tab === 'sms') return <SmsView status={status} viewer={viewer} notify={notify} />
    if (tab === 'automations') return <AutomationsView viewer={viewer} notify={notify} />
    if (tab === 'timeline') return <TimelineView events={events} />
    if (tab === 'system') return <SystemView {...common} />
    if (tab === 'diagnostics') return <DiagnosticsView {...common} />
    if (tab === 'mqtt') return <MqttView {...common} />
    return <SettingsView viewer={viewer} notify={notify} onSaved={reload} />
  })()

  if (!auth.auth) return <div className="boot-screen"><Activity className="spin" /> Loading…</div>
  if (auth.needsLogin && auth.auth.seededDefault && !skipSetup) return <Setup onSuccess={auth.refresh} onSkip={() => setSkipSetup(true)} />
  if (auth.needsLogin) return <Login seededDefault={auth.auth.seededDefault} onSuccess={auth.refresh} />

  const groups = [...new Set(nav.map((item) => item.group))]
  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark"><img src={UNIFI_LOGO} alt="UniFi" /></div><div><strong>UniFi U5G Monitor</strong><span>SMS & cellular operations</span></div></div>
      <div className={`connection-card ${status?.connected ? 'ok' : 'danger'}`}><i /><div><span>{status?.device?.modelDisplay || status?.device?.model || 'UniFi U5G'}</span><strong>{status?.connected ? 'Connected' : 'Offline'}</strong></div></div>
      <nav className="nav">{groups.map((group) => <section key={group}><span className="nav-title">{group}</span>{nav.filter((item) => item.group === group).map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.icon}<span>{item.label}</span>{item.id === 'sms' && Boolean(status?.sms?.unread) && <b>{status?.sms?.unread}</b>}</button>)}</section>)}</nav>
      <div className="sidebar-facts"><span>Gateway<strong>{status?.connection.gatewayHost || '—'}</strong></span><span>Modem<strong>{status?.connection.modemHost || '—'}</strong></span><span>Operator<strong>{status?.radio?.operator || '—'}</strong></span></div>
      <button className="logout-btn" onClick={logout}><LogOut size={15} /> Log out</button>
    </aside>
    <main className="main">
      {viewer && <div className="viewer-banner">Read-only viewer session</div>}
      <header className="topbar"><div><span className="eyebrow">U5G operations console</span><h1>{title}</h1></div><div className="top-actions"><span className={`live ${live ? 'on' : ''}`}><i />{live ? 'live' : 'reconnecting'}</span><span className="updated">{formatRelative(status?.checkedAt, now)}</span><button className="icon-btn" onClick={() => setPaletteOpen(true)} title="Command palette (⌘K)"><Command size={18} /></button><button className="icon-btn" onClick={refresh} disabled={busy || viewer} title="Refresh"><RefreshCw className={busy ? 'spin' : ''} size={18} /></button><button className="icon-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} title="Theme">{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button></div></header>
      {!status?.connected && <div className="offline-banner"><Antenna size={18} /><div><strong>U5G is not connected</strong><span>{status?.connectionError || 'Configure the UCG SSH connection in Settings.'}</span></div></div>}
      <div className="content">{view}</div>
    </main>
    <nav className="mobile-nav">{nav.slice(0, 5).map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.icon}<span>{item.label}</span></button>)}</nav>
    <div className="toast-stack">{toasts.map((item) => <div key={item.id} className={`toast ${item.tone}`}>{item.text}</div>)}</div>
    {paletteOpen && <CommandPalette nav={nav} onNavigate={(id) => { setTab(id); setPaletteOpen(false) }} onClose={() => setPaletteOpen(false)} onRefresh={refresh} onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')} />}
  </div>
}

function CommandPalette({ nav, onNavigate, onClose, onRefresh, onToggleTheme }: { nav: Array<{ id: TabId; label: string; icon: ReactNode; group: string }>; onNavigate: (id: TabId) => void; onClose: () => void; onRefresh: () => void; onToggleTheme: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const actions = [
    { key: 'refresh', label: 'Refresh status', icon: <RefreshCw size={16} />, run: onRefresh },
    { key: 'theme', label: 'Toggle theme', icon: <Sun size={16} />, run: onToggleTheme },
    ...nav.map((item) => ({ key: item.id, label: `Go to ${item.label}`, icon: item.icon, run: () => onNavigate(item.id) })),
  ]
  const filtered = actions.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
  function run(index: number) { const item = filtered[index]; if (item) { item.run(); onClose() } }
  return <div className="modal-backdrop" onClick={onClose}>
    <section className="command-palette" onClick={(e) => e.stopPropagation()}>
      <input
        autoFocus className="input" placeholder="Type a command or search…" value={query}
        onChange={(e) => { setQuery(e.target.value); setSelected(0) }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose()
          else if (e.key === 'ArrowDown') { e.preventDefault(); setSelected((i) => Math.min(i + 1, filtered.length - 1)) }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected((i) => Math.max(i - 1, 0)) }
          else if (e.key === 'Enter') { e.preventDefault(); run(selected) }
        }}
      />
      <div className="palette-list">
        {filtered.map((item, index) => <button key={item.key} className={index === selected ? 'active' : ''} onMouseEnter={() => setSelected(index)} onClick={() => run(index)}>{item.icon}<span>{item.label}</span></button>)}
        {filtered.length === 0 && <div className="empty">No matching commands</div>}
      </div>
    </section>
  </div>
}
