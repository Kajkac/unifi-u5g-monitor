import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, CheckCheck, Clock3, Download, FileText, MessageSquare, Plus, RefreshCw, Search, Send, Trash2, XCircle } from 'lucide-react'
import { api } from './lib'

type Message = { id: string; direction: 'in' | 'out'; peer: string; text: string; timestamp: string; status: 'received' | 'queued' | 'sending' | 'sent' | 'failed' | 'unknown'; read: boolean; source: string; error?: string }
type Template = { id: string; name: string; destination?: string; text: string }
type ListFilter = 'all' | 'unread' | 'failed'
type Thread = { peer: string; messages: Message[]; lastTs: string; unread: number; failed: boolean }

function statusIcon(status: Message['status']) {
  if (status === 'sent') return <CheckCheck size={15} />
  if (status === 'failed') return <XCircle size={15} />
  if (status === 'unknown') return <Clock3 size={15} />
  if (status === 'sending' || status === 'queued') return <RefreshCw className="spin" size={15} />
  return <Check size={15} />
}

function initials(peer: string) {
  const clean = peer.replace(/[^a-zA-Z0-9]/g, '')
  return (clean.slice(-2) || peer.slice(0, 2)).toUpperCase()
}

export function SmsView({ viewer, notify }: { viewer: boolean; notify: (tone: string, text: string) => void }) {
  const [messages, setMessages] = useState<Message[]>([])
  const [templates, setTemplates] = useState<Template[]>([])
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<ListFilter>('all')
  const [loading, setLoading] = useState(false)
  const [initial, setInitial] = useState(true)
  const [selectedPeer, setSelectedPeer] = useState<string | null>(null)
  const [compose, setCompose] = useState(false)
  const [number, setNumber] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [reply, setReply] = useState('')
  const [replying, setReplying] = useState(false)
  const [showTemplates, setShowTemplates] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await api<{ messages: Message[] }>('/api/sms?folder=all&limit=200')
      setMessages(data.messages)
      setTemplates(await api<Template[]>('/api/sms/templates'))
    } finally { setLoading(false); setInitial(false) }
  }, [])
  useEffect(() => { void load(); const timer = setInterval(load, 15000); return () => clearInterval(timer) }, [load])

  const threads = useMemo<Thread[]>(() => {
    const byPeer = new Map<string, Message[]>()
    for (const message of messages) { const list = byPeer.get(message.peer) || []; list.push(message); byPeer.set(message.peer, list) }
    return [...byPeer.entries()]
      .map(([peer, list]) => {
        const sorted = list.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        return { peer, messages: sorted, lastTs: sorted[sorted.length - 1].timestamp, unread: sorted.filter((m) => m.direction === 'in' && !m.read).length, failed: sorted.some((m) => m.status === 'failed' || m.status === 'unknown') }
      })
      .sort((a, b) => b.lastTs.localeCompare(a.lastTs))
  }, [messages])

  const filteredThreads = useMemo(() => threads
    .filter((thread) => filter === 'all' || (filter === 'unread' && thread.unread > 0) || (filter === 'failed' && thread.failed))
    .filter((thread) => `${thread.peer} ${thread.messages.map((m) => m.text).join(' ')}`.toLowerCase().includes(search.toLowerCase())),
    [threads, filter, search])

  useEffect(() => {
    if (selectedPeer && filteredThreads.some((t) => t.peer === selectedPeer)) return
    setSelectedPeer(filteredThreads[0]?.peer ?? null)
  }, [filteredThreads, selectedPeer])

  const activeThread = threads.find((t) => t.peer === selectedPeer) || null

  useEffect(() => {
    if (!activeThread) return
    const unread = activeThread.messages.filter((m) => m.direction === 'in' && !m.read)
    if (unread.length === 0) return
    void Promise.all(unread.map((m) => api(`/api/sms/${encodeURIComponent(m.id)}/read`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ read: true }) }))).then(load)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread?.peer])

  async function remove(message: Message) { if (!confirm('Remove this message from the local archive?')) return; await api(`/api/sms/${encodeURIComponent(message.id)}`, { method: 'DELETE' }); load() }

  async function sendTo(destination: string, body: string, onDone: () => void, setBusy: (v: boolean) => void) {
    if (!destination || !body || viewer) return
    setBusy(true)
    try {
      const result = await api<{ ok: boolean; status: string; message: string }>('/api/sms/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ number: destination, text: body }) })
      notify(result.ok ? 'ok' : result.status === 'unknown' ? 'warn' : 'danger', result.message)
      if (result.ok) { onDone(); setSelectedPeer(destination) }
      await load()
    } catch (error) { notify('danger', error instanceof Error ? error.message : String(error)) } finally { setBusy(false) }
  }

  function applyTemplate(template: Template) { setNumber(template.destination || ''); setText(template.text); setCompose(true) }
  function applyTemplateToReply(template: Template) { setReply(template.text); setShowTemplates(false) }

  const filters: Array<{ id: ListFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: threads.length },
    { id: 'unread', label: 'Unread', count: threads.filter((t) => t.unread > 0).length },
    { id: 'failed', label: 'Needs attention', count: threads.filter((t) => t.failed).length },
  ]

  return <div className="view sms-view">
    <section className="sms-shell">
      <aside className="sms-sidebar conversation-list">
        <button className="btn primary compose-btn" disabled={viewer} onClick={() => setCompose(true)}><Plus size={16} /> New message</button>
        <div className="search"><Search size={15} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search conversations" /></div>
        <div className="filter-tabs sms-filter-tabs">{filters.map((item) => <button key={item.id} className={filter === item.id ? 'active' : ''} onClick={() => setFilter(item.id)}>{item.label}{item.count > 0 && <b>{item.count}</b>}</button>)}</div>
        <div className="thread-list">
          {initial && loading && Array.from({ length: 5 }).map((_, i) => <div className="thread-row skeleton-row" key={i}><span className="skeleton skeleton-avatar" /><span className="skeleton skeleton-lines"><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line short" /></span></div>)}
          {!initial && filteredThreads.map((thread) => <button key={thread.peer} className={`thread-row ${selectedPeer === thread.peer ? 'active' : ''}`} onClick={() => setSelectedPeer(thread.peer)}>
            <span className="thread-avatar">{initials(thread.peer)}</span>
            <span className="thread-copy">
              <span className="thread-top"><strong>{thread.peer}</strong><time>{new Date(thread.lastTs).toLocaleDateString([], { month: 'short', day: 'numeric' })}</time></span>
              <span className="thread-preview">{thread.failed && <XCircle size={12} className="thread-flag" />}{thread.messages[thread.messages.length - 1].text}</span>
            </span>
            {thread.unread > 0 && <b>{thread.unread}</b>}
          </button>)}
          {!initial && filteredThreads.length === 0 && <div className="empty tall-empty">
            {search
              ? <><Search size={30} /><strong>No matches for “{search}”</strong><span>Try a different name or keyword.</span><button className="btn" onClick={() => setSearch('')}>Clear search</button></>
              : filter === 'unread'
                ? <><CheckCheck size={30} /><strong>You're all caught up</strong><span>No unread conversations.</span></>
                : filter === 'failed'
                  ? <><AlertTriangle size={30} /><strong>Nothing needs attention</strong><span>No failed or unknown sends.</span></>
                  : <><MessageSquare size={30} /><strong>No conversations yet</strong><span>Incoming U5G messages will show up here.</span><button className="btn primary" disabled={viewer} onClick={() => setCompose(true)}><Plus size={15} /> New message</button></>}
          </div>}
        </div>
        {templates.length > 0 && <><div className="template-title"><FileText size={15} /> Templates</div>{templates.map((template) => <button className="template-link" key={template.id} onClick={() => applyTemplate(template)}><span>{template.name}</span></button>)}</>}
      </aside>
      <div className="sms-main thread-pane">
        {activeThread ? <>
          <header className="sms-toolbar"><div><h2>{activeThread.peer}</h2><span>{activeThread.messages.length} messages</span></div><a className="icon-btn" href="/api/export/sms.csv" title="Export CSV"><Download size={17} /></a><button className="icon-btn" onClick={load}><RefreshCw size={17} className={loading ? 'spin' : ''} /></button></header>
          <div className="thread-messages">
            {activeThread.messages.map((message) => <div key={message.id} className={`bubble-row ${message.direction}`}>
              <div className={`bubble ${message.direction} ${message.status}`}>
                <p>{message.text}</p>
                <small>{new Date(message.timestamp).toLocaleString()}{message.direction === 'out' && <> · {statusIcon(message.status)} {message.status}</>}{message.error && ` · ${message.error}`}</small>
              </div>
              <button className="icon-btn danger-icon bubble-delete" title="Remove from archive" disabled={viewer} onClick={() => remove(message)}><Trash2 size={13} /></button>
            </div>)}
          </div>
          <div className="thread-compose">
            {showTemplates && templates.length > 0 && <div className="thread-template-pop">{templates.map((template) => <button key={template.id} onClick={() => applyTemplateToReply(template)}>{template.name}</button>)}</div>}
            <button className="icon-btn" title="Insert template" disabled={viewer || templates.length === 0} onClick={() => setShowTemplates((v) => !v)}><FileText size={16} /></button>
            <textarea className="input" rows={1} maxLength={480} placeholder="Type a message…" value={reply} disabled={viewer} onChange={(e) => setReply(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (reply.trim()) sendTo(activeThread.peer, reply, () => setReply(''), setReplying) } }} />
            <button className="btn primary" disabled={viewer || replying || !reply.trim()} onClick={() => sendTo(activeThread.peer, reply, () => setReply(''), setReplying)}>{replying ? <RefreshCw className="spin" size={15} /> : <Send size={15} />}</button>
          </div>
        </> : <div className="empty tall-empty"><MessageSquare size={30} /><strong>{initial ? 'Loading conversations…' : 'Select a conversation'}</strong></div>}
      </div>
    </section>
    {compose && <div className="modal-backdrop" onClick={() => !sending && setCompose(false)}><section className="modal compose-modal" onClick={(e) => e.stopPropagation()}><header><div><span className="eyebrow">U5G SMS</span><h2>New message</h2></div><button className="icon-btn" onClick={() => setCompose(false)}>×</button></header><label>Destination<input className="input" placeholder="+385… or shortcode" value={number} onChange={(e) => setNumber(e.target.value)} /></label><label>Message<textarea className="input" rows={6} maxLength={480} value={text} onChange={(e) => setText(e.target.value)} /></label><div className="compose-meta"><span>{text.length}/480 characters</span><span>An unknown timeout result is never retried automatically.</span></div><div className="button-row end"><button className="btn" onClick={() => setCompose(false)}>Cancel</button><button className="btn primary" disabled={sending || !number || !text} onClick={() => sendTo(number, text, () => { setCompose(false); setText('') }, setSending)}>{sending ? <RefreshCw className="spin" size={15} /> : <Send size={15} />} Send SMS</button></div></section></div>}
  </div>
}
