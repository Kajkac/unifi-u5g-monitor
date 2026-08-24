import Database from "better-sqlite3";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { config, dataDir } from "./config.js";
import type { AppEvent, SmsMessage, U5gStatus } from "./types.js";

export const db = new Database(path.join(dataDir, "u5g-monitor.sqlite"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS sms_messages (
  id TEXT PRIMARY KEY,
  direction TEXT NOT NULL,
  peer TEXT NOT NULL,
  text TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  status TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL,
  error TEXT,
  raw_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_sms_time ON sms_messages(timestamp DESC);
CREATE TABLE IF NOT EXISTS sms_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL REFERENCES sms_messages(id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  result TEXT,
  error TEXT
);
CREATE TABLE IF NOT EXISTS sms_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  destination TEXT,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  level TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  data_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(ts DESC);
CREATE TABLE IF NOT EXISTS metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  connected INTEGER NOT NULL,
  lte_rsrp REAL,
  lte_rsrq REAL,
  lte_snr REAL,
  nr_rsrp REAL,
  nr_rsrq REAL,
  nr_snr REAL,
  signal_percent REAL,
  rx_bytes INTEGER,
  tx_bytes INTEGER,
  cell_id TEXT,
  pci TEXT,
  band TEXT
);
CREATE INDEX IF NOT EXISTS idx_metrics_time ON metrics(ts);
CREATE TABLE IF NOT EXISTS automation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id TEXT NOT NULL,
  ts TEXT NOT NULL,
  sms_id TEXT,
  outcome TEXT NOT NULL,
  message TEXT
);
`);

const upsertIncoming = db.prepare(`INSERT INTO sms_messages
  (id,direction,peer,text,timestamp,status,is_read,source,raw_json)
  VALUES (@id,'in',@peer,@text,@timestamp,'received',0,'modem',@raw)
  ON CONFLICT(id) DO NOTHING`);

export function storeIncoming(value: { id: string; from?: string; text?: string; timestamp?: number; [key: string]: unknown }): boolean {
  const timestamp = value.timestamp ? new Date(value.timestamp * 1000).toISOString() : new Date().toISOString();
  const result = upsertIncoming.run({ id: value.id, peer: value.from || "Unknown", text: value.text || "", timestamp, raw: JSON.stringify(value) });
  return result.changes > 0;
}

export function createOutgoing(peer: string, text: string, source: "manual" | "automation" = "manual"): SmsMessage {
  const message: SmsMessage = { id: randomUUID(), direction: "out", peer, text, timestamp: new Date().toISOString(), status: "queued", read: true, source };
  db.prepare("INSERT INTO sms_messages (id,direction,peer,text,timestamp,status,is_read,source) VALUES (?,?,?,?,?,?,?,?)")
    .run(message.id, message.direction, message.peer, message.text, message.timestamp, message.status, 1, source);
  return message;
}

export function updateOutgoing(id: string, status: SmsMessage["status"], error = "") {
  db.prepare("UPDATE sms_messages SET status=?, error=? WHERE id=?").run(status, error || null, id);
}

export function startAttempt(messageId: string): number {
  return Number(db.prepare("INSERT INTO sms_attempts (message_id,started_at,result) VALUES (?,?,'sending')").run(messageId, new Date().toISOString()).lastInsertRowid);
}

export function finishAttempt(id: number, result: string, error = "") {
  db.prepare("UPDATE sms_attempts SET completed_at=?,result=?,error=? WHERE id=?").run(new Date().toISOString(), result, error || null, id);
}

export function listSms(folder: string, limit = 100, offset = 0): { messages: SmsMessage[]; total: number } {
  const where = folder === "inbox" ? "direction='in'" : folder === "outbox" ? "direction='out'" : folder === "unread" ? "direction='in' AND is_read=0" : "1=1";
  const rows = db.prepare(`SELECT id,direction,peer,text,timestamp,status,is_read AS isRead,source,error FROM sms_messages WHERE ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`).all(limit, offset) as Array<Record<string, unknown>>;
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM sms_messages WHERE ${where}`).get() as { n: number }).n);
  return { messages: rows.map((row) => ({ ...row, read: Boolean(row.isRead) } as unknown as SmsMessage)), total };
}

export function markSms(id: string, read: boolean) {
  db.prepare("UPDATE sms_messages SET is_read=? WHERE id=?").run(read ? 1 : 0, id);
}

export function deleteSms(id: string) {
  db.prepare("DELETE FROM sms_messages WHERE id=?").run(id);
}

export function smsCounts() {
  const row = db.prepare(`SELECT
    SUM(CASE WHEN direction='in' THEN 1 ELSE 0 END) inbox,
    SUM(CASE WHEN direction='in' AND is_read=0 THEN 1 ELSE 0 END) unread,
    SUM(CASE WHEN direction='out' THEN 1 ELSE 0 END) outbox,
    SUM(CASE WHEN direction='out' AND status IN ('failed','unknown') THEN 1 ELSE 0 END) failed
    FROM sms_messages`).get() as Record<string, number | null>;
  return { inbox: row.inbox ?? 0, unread: row.unread ?? 0, outbox: row.outbox ?? 0, failed: row.failed ?? 0 };
}

export function recordMetric(status: U5gStatus) {
  db.prepare(`INSERT INTO metrics (ts,connected,lte_rsrp,lte_rsrq,lte_snr,nr_rsrp,nr_rsrq,nr_snr,signal_percent,rx_bytes,tx_bytes,cell_id,pci,band)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(status.checkedAt, status.connected ? 1 : 0, status.radio?.lte?.rsrp ?? null, status.radio?.lte?.rsrq ?? null,
      status.radio?.lte?.snr ?? null, status.radio?.nr?.rsrp ?? null, status.radio?.nr?.rsrq ?? null, status.radio?.nr?.snr ?? null,
      status.radio?.signalPercent ?? null, status.sim?.rxBytes ?? null, status.sim?.txBytes ?? null, status.radio?.cellId ?? null, status.radio?.pci ?? null, status.radio?.band ?? null);
}

export function history(minutes: number) {
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const rows = db.prepare("SELECT * FROM metrics WHERE ts>=? ORDER BY id").all(since) as Array<Record<string, unknown>>;
  const step = Math.max(1, Math.floor(rows.length / 240));
  return rows.filter((_, i) => i % step === 0).map((r) => ({
    ts: r.ts, connected: Boolean(r.connected), lteRsrp: r.lte_rsrp, lteRsrq: r.lte_rsrq, lteSnr: r.lte_snr,
    nrRsrp: r.nr_rsrp, nrRsrq: r.nr_rsrq, nrSnr: r.nr_snr, signalPercent: r.signal_percent,
    rxBytes: r.rx_bytes, txBytes: r.tx_bytes, cellId: r.cell_id, pci: r.pci, band: r.band,
  }));
}

export function emitEvent(event: AppEvent) {
  const result = db.prepare("INSERT INTO events (ts,level,kind,message,data_json) VALUES (?,?,?,?,?)")
    .run(event.ts, event.level, event.kind, event.message, event.data == null ? null : JSON.stringify(event.data));
  return { ...event, id: Number(result.lastInsertRowid) };
}

export function listEvents(limit = 200) {
  return (db.prepare("SELECT id,ts,level,kind,message,data_json AS dataJson FROM events ORDER BY id DESC LIMIT ?").all(limit) as Array<Record<string, unknown>>)
    .map((row) => ({ ...row, data: row.dataJson ? JSON.parse(String(row.dataJson)) : undefined })).reverse();
}

export function recordAutomationRun(ruleId: string, outcome: string, message: string, smsId?: string) {
  db.prepare("INSERT INTO automation_runs(rule_id,ts,sms_id,outcome,message) VALUES (?,?,?,?,?)").run(ruleId, new Date().toISOString(), smsId ?? null, outcome, message);
}

export function automationStats() {
  return db.prepare("SELECT rule_id AS ruleId, COUNT(*) runs, SUM(CASE WHEN outcome='ok' THEN 0 ELSE 1 END) failures, MAX(ts) lastRunAt FROM automation_runs GROUP BY rule_id").all();
}

export function listTemplates() {
  return db.prepare("SELECT id,name,destination,text,created_at AS createdAt,updated_at AS updatedAt FROM sms_templates ORDER BY name").all();
}

export function saveTemplate(value: { id?: string; name: string; destination?: string; text: string }) {
  const id = value.id || randomUUID();
  const time = new Date().toISOString();
  db.prepare(`INSERT INTO sms_templates(id,name,destination,text,created_at,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET name=excluded.name,destination=excluded.destination,text=excluded.text,updated_at=excluded.updated_at`)
    .run(id, value.name, value.destination || null, value.text, time, time);
  return { id };
}

export function deleteTemplate(id: string) {
  db.prepare("DELETE FROM sms_templates WHERE id=?").run(id);
}

export function databaseStats() {
  const pageCount = Number((db.pragma("page_count", { simple: true }) as number) || 0);
  const pageSize = Number((db.pragma("page_size", { simple: true }) as number) || 0);
  const tables: Record<string, number> = {};
  for (const table of ["sms_messages", "sms_attempts", "sms_templates", "events", "metrics", "automation_runs"]) {
    tables[table] = Number((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n);
  }
  return { sizeBytes: pageCount * pageSize, tables };
}

export function compact() {
  const before = databaseStats();
  cleanup();
  db.pragma("wal_checkpoint(TRUNCATE)");
  db.exec("VACUUM");
  return { before, after: databaseStats() };
}

export function cleanup() {
  db.prepare("DELETE FROM metrics WHERE ts < ?").run(new Date(Date.now() - config.retention.metricsDays * 86400000).toISOString());
  db.prepare("DELETE FROM events WHERE ts < ? AND kind != 'audit'").run(new Date(Date.now() - config.retention.eventsDays * 86400000).toISOString());
  db.prepare("DELETE FROM events WHERE ts < ? AND kind = 'audit'").run(new Date(Date.now() - config.retention.auditDays * 86400000).toISOString());
  const count = Number((db.prepare("SELECT COUNT(*) n FROM metrics").get() as { n: number }).n);
  if (count > config.retention.maxMetrics) db.prepare("DELETE FROM metrics WHERE id IN (SELECT id FROM metrics ORDER BY id LIMIT ?)").run(count - config.retention.maxMetrics);
  return { metrics: Number((db.prepare("SELECT COUNT(*) n FROM metrics").get() as { n: number }).n), events: Number((db.prepare("SELECT COUNT(*) n FROM events").get() as { n: number }).n) };
}
