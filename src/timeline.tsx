import { useMemo, useState } from 'react'
import { Activity, Bot, MessageSquare, Settings, ShieldAlert, Wifi } from 'lucide-react'
import type { EventRow } from './lib'

const groups = ['all', 'connection', 'sms', 'automation', 'settings'] as const

function icon(kind: string) {
  if (kind === 'sms') return <MessageSquare size={16} />
  if (kind === 'automation') return <Bot size={16} />
  if (kind === 'settings' || kind === 'audit') return <Settings size={16} />
  if (kind === 'connection') return <Wifi size={16} />
  return <Activity size={16} />
}

export function TimelineView({ events }: { events: EventRow[] }) {
  const [filter, setFilter] = useState<(typeof groups)[number]>('all')
  const [selected, setSelected] = useState<EventRow | null>(null)
  const rows = useMemo(() => events.filter((event) => filter === 'all' || event.kind === filter).slice().reverse(), [events, filter])
  return <div className="view"><section className="card timeline-card"><header><div><Activity size={18} /><h2>Operational timeline</h2></div><div className="filter-tabs">{groups.map((group) => <button key={group} className={filter === group ? 'active' : ''} onClick={() => setFilter(group)}>{group}</button>)}</div></header><div className="timeline">{rows.map((event) => <button className={`timeline-row ${event.level}`} key={`${event.id}-${event.ts}`} onClick={() => setSelected(event)}><div className="timeline-icon">{icon(event.kind)}</div><div><span>{event.kind}</span><strong>{event.message}</strong><time>{new Date(event.ts).toLocaleString()}</time></div></button>)}{rows.length === 0 && <div className="empty tall-empty">
          {filter === 'all'
            ? <><Activity size={30} /><strong>Nothing here yet</strong><span>Connection changes, SMS activity and automation runs will show up as they happen.</span></>
            : <><Activity size={30} /><strong>No {filter} events</strong><span>Try a different filter, or check back after something happens.</span><button className="btn" onClick={() => setFilter('all')}>Show all events</button></>}
        </div>}</div></section>{selected && <div className="modal-backdrop" onClick={() => setSelected(null)}><section className="modal event-modal" onClick={(e) => e.stopPropagation()}><header><div><span className="eyebrow">{selected.kind}</span><h2>{selected.message}</h2></div><button className="icon-btn" onClick={() => setSelected(null)}>×</button></header><div className={`notice ${selected.level === 'error' ? 'danger' : selected.level === 'warn' ? 'warn' : 'ok'}`}><ShieldAlert size={18} /><span>{selected.level.toUpperCase()} · {new Date(selected.ts).toLocaleString()}</span></div>{selected.data != null && <pre className="json-block">{JSON.stringify(selected.data, null, 2)}</pre>}</section></div>}</div>
}
