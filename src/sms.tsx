import { useCallback, useEffect, useMemo, useState } from 'react'
import { Archive, Check, CheckCheck, Clock3, Download, FileText, Inbox, MessageSquare, Plus, RefreshCw, Search, Send, Trash2, XCircle } from 'lucide-react'
import { api, type Status } from './lib'

type Message = { id: string; direction: 'in' | 'out'; peer: string; text: string; timestamp: string; status: 'received' | 'queued' | 'sending' | 'sent' | 'failed' | 'unknown'; read: boolean; source: string; error?: string }
type Template = { id: string; name: string; destination?: string; text: string }
type Folder = 'inbox' | 'outbox' | 'unread' | 'all'

function statusIcon(status: Message['status']) {
  if (status === 'sent') return <CheckCheck size={15} />
  if (status === 'failed') return <XCircle size={15} />
  if (status === 'unknown') return <Clock3 size={15} />
  if (status === 'sending' || status === 'queued') return <RefreshCw className="spin" size={15} />
  return <Check size={15} />
}

export function SmsView({ status, viewer, notify }: { status: Status | null; viewer: boolean; notify: (tone: string, text: string) => void }) {
  const [folder, setFolder] = useState<Folder>('inbox')
  const [messages, setMessages] = useState<Message[]>([])
  const [counts, setCounts] = useState(status?.sms || { inbox: 0, unread: 0, outbox: 0, failed: 0 })
  const [templates, setTemplates] = useState<Template[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [compose, setCompose] = useState(false)
  const [number, setNumber] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ messages: Message[]; counts: typeof counts }>(`/api/sms?folder=${folder}&limit=200`)
      setMessages(data.messages); setCounts(data.counts)
      setTemplates(await api<Template[]>('/api/sms/templates'))
    } finally { setLoading(false) }
  }, [folder])
  useEffect(() => { void load(); const timer = setInterval(load, 15000); return () => clearInterval(timer) }, [load])

  const filtered = useMemo(() => messages.filter((message) => `${message.peer} ${message.text}`.toLowerCase().includes(search.toLowerCase())), [messages, search])
  async function mark(message: Message) { await api(`/api/sms/${encodeURIComponent(message.id)}/read`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: true }) }); load() }
  async function remove(message: Message) { if (!confirm('Remove this message from the local archive?')) return; await api(`/api/sms/${encodeURIComponent(message.id)}`, { method: 'DELETE' }); load() }
  async function send() {
    if (!number || !text || viewer) return
    setSending(true)
    try {
      const result = await api<{ ok: boolean; status: string; message: string }>('/api/sms/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number, text }) })
      notify(result.ok ? 'ok' : result.status === 'unknown' ? 'warn' : 'danger', result.message)
      if (result.ok) { setCompose(false); setText(''); setFolder('outbox') }
      await load()
    } catch (error) { notify('danger', error instanceof Error ? error.message : String(error)) } finally { setSending(false) }
  }
  function applyTemplate(template: Template) { setNumber(template.destination || ''); setText(template.text); setCompose(true) }

  const folders: Array<{ id: Folder; label: string; count: number; icon: typeof Inbox }> = [
    { id: 'inbox', label: 'Inbox', count: counts.inbox, icon: Inbox }, { id: 'unread', label: 'Unread', count: counts.unread, icon: MessageSquare },
    { id: 'outbox', label: 'Outbox', count: counts.outbox, icon: Send }, { id: 'all', label: 'All', count: counts.inbox + counts.outbox, icon: Archive },
  ]
  return <div className="view sms-view">
    <section className="sms-shell">
      <aside className="sms-sidebar"><button className="btn primary compose-btn" disabled={viewer} onClick={() => setCompose(true)}><Plus size={16} /> New message</button>{folders.map((item) => <button key={item.id} className={folder === item.id ? 'active' : ''} onClick={() => setFolder(item.id)}><item.icon size={17} /><span>{item.label}</span><b>{item.count}</b></button>)}<div className="template-title"><FileText size={15} /> Templates</div>{templates.map((template) => <button className="template-link" key={template.id} onClick={() => applyTemplate(template)}><span>{template.name}</span></button>)}</aside>
      <div className="sms-main"><header className="sms-toolbar"><div><h2>{folders.find((item) => item.id === folder)?.label}</h2><span>{counts.unread} unread · {counts.failed} attention</span></div><div className="search"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search messages" /></div><a className="icon-btn" href="/api/export/sms.csv" title="Export CSV"><Download size={17} /></a><button className="icon-btn" onClick={load}><RefreshCw size={17} className={loading ? 'spin' : ''} /></button></header>
        <div className="message-list">{filtered.map((message) => <article key={message.id} className={`message-row ${!message.read ? 'unread' : ''} ${message.status}`} onClick={() => !message.read && mark(message)}><div className="message-avatar">{message.direction === 'in' ? <Inbox size={17} /> : <Send size={17} />}</div><div className="message-copy"><div><strong>{message.peer}</strong><time>{new Date(message.timestamp).toLocaleString()}</time></div><p>{message.text}</p><small className={`message-status ${message.status}`}>{statusIcon(message.status)} {message.status}{message.source !== 'manual' && ` · ${message.source}`}{message.error && ` · ${message.error}`}</small></div><button className="icon-btn danger-icon" title="Remove from archive" disabled={viewer} onClick={(event) => { event.stopPropagation(); remove(message) }}><Trash2 size={16} /></button></article>)}{!loading && filtered.length === 0 && <div className="empty tall-empty"><MessageSquare size={30} /><strong>No messages</strong><span>Incoming U5G messages will be archived here.</span></div>}</div>
      </div>
    </section>
    {compose && <div className="modal-backdrop" onClick={() => !sending && setCompose(false)}><section className="modal compose-modal" onClick={(e) => e.stopPropagation()}><header><div><span className="eyebrow">U5G SMS</span><h2>New message</h2></div><button className="icon-btn" onClick={() => setCompose(false)}>×</button></header><label>Destination<input className="input" placeholder="+385… or shortcode" value={number} onChange={(e) => setNumber(e.target.value)} /></label><label>Message<textarea className="input" rows={6} maxLength={480} value={text} onChange={(e) => setText(e.target.value)} /></label><div className="compose-meta"><span>{text.length}/480 characters</span><span>An unknown timeout result is never retried automatically.</span></div><div className="button-row end"><button className="btn" onClick={() => setCompose(false)}>Cancel</button><button className="btn primary" disabled={sending || !number || !text} onClick={send}>{sending ? <RefreshCw className="spin" size={15} /> : <Send size={15} />} Send SMS</button></div></section></div>}
  </div>
}
