import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { config, publicConfig, rootDir, saveConfig, setPassword, verifyPassword } from "./config.js";
import {
  automationStats, cleanup, compact, createOutgoing, databaseStats, deleteSms, deleteTemplate, emitEvent as persistEvent, exportMetrics, exportSms, finishAttempt,
  history, listEvents, listSms, listTemplates, markSms, recordMetric, saveTemplate, smsCounts, startAttempt, storeIncoming, updateOutgoing,
} from "./database.js";
import { collectU5gStatus, diagnostics, readModemSms, sendModemSms, testConnection } from "./u5g.js";
import { applyMqtt, mqttState, publishDiscovery, publishSms, publishStatus } from "./mqtt.js";
import { notify } from "./notifications.js";
import { dryRun, evaluateIncomingSms, runRuleNow, runScheduled } from "./automations.js";
import type { AppEvent, AutomationRule, U5gStatus } from "./types.js";

const startedAt = Date.now();
let currentStatus: U5gStatus | null = null;
let polling = false;
let lastConnectionState: boolean | undefined;
let lastPollError = "";
const sockets = new Set<{ send: (data: string) => void }>();

function broadcast(payload: unknown) {
  const data = JSON.stringify(payload);
  for (const socket of sockets) {
    try { socket.send(data); } catch { sockets.delete(socket); }
  }
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]): string {
  const lines = [columns.join(",")];
  for (const row of rows) lines.push(columns.map((col) => csvCell(row[col])).join(","));
  return lines.join("\n");
}

function emitEvent(event: AppEvent) {
  const stored = persistEvent(event);
  broadcast({ type: "event", event: stored });
  return stored;
}

async function sendSms(peer: string, text: string, source: "manual" | "automation" = "manual") {
  const message = createOutgoing(peer, text, source);
  updateOutgoing(message.id, "sending");
  const attempt = startAttempt(message.id);
  const result = await sendModemSms(peer, text);
  updateOutgoing(message.id, result.status, result.status === "sent" ? "" : result.output.slice(0, 500));
  finishAttempt(attempt, result.status, result.status === "sent" ? "" : result.output.slice(0, 500));
  emitEvent({ ts: new Date().toISOString(), level: result.status === "sent" ? "action" : result.status === "unknown" ? "warn" : "error", kind: "sms", message: `SMS to ${peer}: ${result.status}`, data: { messageId: message.id } });
  return { ok: result.status === "sent", status: result.status, message: result.status === "sent" ? "Message sent" : result.output, id: message.id };
}

const automationActions = { send: async (number: string, text: string) => {
  const result = await sendSms(number, text, "automation");
  return { ok: result.ok, message: result.message };
} };

async function poll() {
  if (polling) return currentStatus;
  polling = true;
  try {
    const status = await collectU5gStatus();
    status.sms = smsCounts();
    currentStatus = status;
    if (lastConnectionState !== undefined && lastConnectionState !== status.connected) {
      emitEvent({ ts: status.checkedAt, level: status.connected ? "info" : "error", kind: "connection", message: status.connected ? "U5G connection restored" : `U5G connection lost: ${status.connectionError || "unknown error"}` });
      if (!status.connected && config.notifications.enabled && config.notifications.connectionLost) void notify("U5G connection lost", status.connectionError || "Unable to connect through UCG");
    }
    lastConnectionState = status.connected;
    if (status.connected) {
      try {
        const messages = await readModemSms();
        for (const sms of messages) {
          if (!storeIncoming(sms)) continue;
          emitEvent({ ts: new Date().toISOString(), level: "info", kind: "sms", message: `SMS received from ${sms.from || "Unknown"}`, data: { smsId: sms.id } });
          publishSms(sms);
          if (config.notifications.enabled && config.notifications.incomingSms) void notify(`SMS from ${sms.from || "Unknown"}`, String(sms.text || ""));
          await evaluateIncomingSms(sms, automationActions);
        }
        status.sms = smsCounts();
        lastPollError = "";
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastPollError) emitEvent({ ts: new Date().toISOString(), level: "warn", kind: "sms", message: `SMS collector: ${message}` });
        lastPollError = message;
      }
    }
    recordMetric(status);
    publishStatus(status);
    broadcast({ type: "status", status });
    return status;
  } finally {
    polling = false;
  }
}

type Session = { role: "admin" | "viewer"; expires: number };
const sessions = new Map<string, Session>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const SESSION_MS = 7 * 86400000;

function session(req: { headers: { cookie?: string } }): Session | null {
  const token = (req.headers.cookie ?? "").match(/(?:^|;\s*)u5g_sess=([a-f0-9]+)/)?.[1];
  if (!token) return null;
  const value = sessions.get(token);
  if (!value || value.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return value;
}

const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
await app.register(websocket);

app.addHook("onRequest", async (request, reply) => {
  if (!config.auth.enabled) return;
  const url = request.url.split("?")[0];
  const isApi = url.startsWith("/api/");
  const isWs = url === "/ws";
  if (!isApi && !isWs) return;
  if (isApi && ["/api/login", "/api/auth", "/api/version", "/api/setup"].includes(url)) return;
  const active = session(request);
  if (!active) return reply.code(401).send({ error: "Authentication required" });
  if (isApi && !["GET", "HEAD"].includes(request.method.toUpperCase()) && active.role !== "admin") return reply.code(403).send({ error: "Admin required" });
});

app.post("/api/login", async (request, reply) => {
  const key = request.ip;
  const attempt = loginAttempts.get(key);
  if (attempt && attempt.resetAt > Date.now() && attempt.count >= 8) return reply.code(429).send({ error: "Too many attempts. Try again later." });
  const password = String((request.body as { password?: string } | undefined)?.password ?? "");
  let role: "admin" | "viewer" | undefined;
  if (verifyPassword(password, config.auth.adminHash)) role = "admin";
  else if (config.auth.viewerEnabled && verifyPassword(password, config.auth.viewerHash)) role = "viewer";
  if (!role) {
    loginAttempts.set(key, { count: (attempt?.resetAt ?? 0) > Date.now() ? attempt!.count + 1 : 1, resetAt: Date.now() + 15 * 60000 });
    return reply.code(401).send({ error: "Invalid password" });
  }
  loginAttempts.delete(key);
  const token = randomBytes(24).toString("hex");
  sessions.set(token, { role, expires: Date.now() + SESSION_MS });
  const secure = request.headers["x-forwarded-proto"] === "https";
  reply.header("set-cookie", `u5g_sess=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure ? "; Secure" : ""}`);
  return { ok: true, role };
});

app.post("/api/logout", async (request, reply) => {
  const token = (request.headers.cookie ?? "").match(/(?:^|;\s*)u5g_sess=([a-f0-9]+)/)?.[1];
  if (token) sessions.delete(token);
  reply.header("set-cookie", "u5g_sess=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0");
  return { ok: true };
});

app.get("/api/auth", async (request) => {
  const active = session(request);
  return { enabled: config.auth.enabled, authenticated: Boolean(active), role: active?.role ?? null, seededDefault: config.auth.seededDefault };
});

const setupSchema = z.object({
  gatewayHost: z.string().trim().min(1),
  gatewayUser: z.string().trim().min(1).default("root"),
  gatewayPassword: z.string().min(1),
  adminPassword: z.string().min(4),
});
app.post("/api/setup", async (request, reply) => {
  if (!config.auth.seededDefault) return reply.code(403).send({ error: "Setup already completed. Use Settings to change connection or password." });
  const parsed = setupSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Fill in the gateway host, its SSH password, and a new admin password (min 4 characters)." });
  config.connection.gateway.host = parsed.data.gatewayHost;
  config.connection.gateway.user = parsed.data.gatewayUser;
  config.connection.gateway.password = parsed.data.gatewayPassword;
  setPassword("admin", parsed.data.adminPassword);
  saveConfig();
  emitEvent({ ts: new Date().toISOString(), level: "action", kind: "settings", message: "Initial setup completed" });
  return { ok: true };
});

app.get("/api/status", async () => currentStatus ?? { checkedAt: new Date().toISOString(), connected: false, connection: { gatewayHost: config.connection.gateway.host, modemHost: config.connection.modem.host, mode: "ssh-jump" }, sms: smsCounts() });
app.post("/api/actions/refresh", async () => poll());
app.post("/api/connection/test", async () => testConnection());
app.get("/api/history", async (request) => history(Math.min(43200, Math.max(5, Number((request.query as { minutes?: string }).minutes ?? 60) || 60))));
app.get("/api/events", async (request) => listEvents(Math.min(500, Math.max(1, Number((request.query as { limit?: string }).limit ?? 200) || 200))));
app.get("/api/timeline", async (request) => listEvents(Math.min(1000, Math.max(1, Number((request.query as { limit?: string }).limit ?? 300) || 300))));

app.get("/api/sms", async (request) => {
  const query = request.query as { folder?: string; limit?: string; offset?: string };
  return { ...listSms(query.folder ?? "all", Math.min(200, Math.max(1, Number(query.limit ?? 100) || 100)), Math.max(0, Number(query.offset ?? 0) || 0)), counts: smsCounts() };
});

const smsSchema = z.object({ number: z.string().trim().regex(/^(?:\+[1-9]\d{5,14}|\d{3,6})$/), text: z.string().min(1).max(480) });
app.post("/api/sms/send", async (request, reply) => {
  const parsed = smsSchema.safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Use an E.164 number (+385...) or shortcode and a message up to 480 characters." });
  return sendSms(parsed.data.number, parsed.data.text);
});
app.put("/api/sms/:id/read", async (request) => { markSms((request.params as { id: string }).id, Boolean((request.body as { read?: boolean }).read)); return { ok: true }; });
app.delete("/api/sms/:id", async (request) => { deleteSms((request.params as { id: string }).id); return { ok: true }; });
app.get("/api/sms/templates", async () => listTemplates());
app.put("/api/sms/templates", async (request, reply) => {
  const parsed = z.object({ id: z.string().optional(), name: z.string().min(1).max(80), destination: z.string().max(32).optional(), text: z.string().min(1).max(480) }).safeParse(request.body);
  if (!parsed.success) return reply.code(400).send({ error: "Invalid template" });
  return saveTemplate(parsed.data);
});
app.delete("/api/sms/templates/:id", async (request) => { deleteTemplate((request.params as { id: string }).id); return { ok: true }; });

app.get("/api/export/sms.csv", async (_request, reply) => {
  const csv = toCsv(exportSms() as unknown as Array<Record<string, unknown>>, ["id", "direction", "peer", "text", "timestamp", "status", "read", "source", "error"]);
  reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="u5g-sms.csv"');
  return csv;
});

app.get("/api/export/metrics.csv", async (request, reply) => {
  const minutes = Math.min(43200, Math.max(5, Number((request.query as { minutes?: string }).minutes ?? 1440) || 1440));
  const csv = toCsv(exportMetrics(minutes), ["ts", "connected", "lteRsrp", "lteRsrq", "lteSnr", "nrRsrp", "nrRsrq", "nrSnr", "signalPercent", "rxBytes", "txBytes", "cellId", "pci", "band"]);
  reply.header("content-type", "text/csv; charset=utf-8").header("content-disposition", 'attachment; filename="u5g-metrics.csv"');
  return csv;
});

app.get("/api/automation", async () => ({ enabled: config.automation.enabled, rules: config.automation.rules.map((rule) => ({ ...rule, dryRun: dryRun(rule) })), stats: automationStats(), catalog: {
  triggers: [{ id: "incoming_sms", label: "Incoming SMS" }, { id: "scheduled", label: "Daily schedule" }],
  actions: [{ id: "reply", label: "Reply to sender" }, { id: "send_sms", label: "Send SMS" }, { id: "notify", label: "Send notification" }, { id: "mqtt", label: "Publish MQTT event" }],
} }));
app.put("/api/automation", async (request) => {
  const body = request.body as { enabled?: boolean; rules?: AutomationRule[] };
  if (typeof body.enabled === "boolean") config.automation.enabled = body.enabled;
  if (Array.isArray(body.rules)) config.automation.rules = body.rules.slice(0, 100).map((rule) => ({ ...rule, cooldownMs: Math.max(0, Number(rule.cooldownMs) || 0), maxPerDay: Math.min(1000, Math.max(1, Number(rule.maxPerDay) || 1)) }));
  saveConfig();
  emitEvent({ ts: new Date().toISOString(), level: "action", kind: "settings", message: "Automation settings updated" });
  return { ok: true };
});
app.post("/api/automation/run", async (request, reply) => {
  const id = String((request.body as { id?: string }).id ?? "");
  if (!id) return reply.code(400).send({ error: "Rule id required" });
  return runRuleNow(id, automationActions);
});
app.post("/api/automation/dry-run", async (request, reply) => {
  const rule = (request.body as { rule?: AutomationRule }).rule;
  if (!rule) return reply.code(400).send({ error: "Rule required" });
  return dryRun(rule);
});

app.get("/api/settings", async () => publicConfig());
app.put("/api/settings", async (request, reply) => {
  const body = request.body as Record<string, any>;
  try {
    if (body.server) {
      if (body.server.host) config.server.host = String(body.server.host);
      if (body.server.port) config.server.port = Math.min(65535, Math.max(1024, Number(body.server.port)));
      if (body.server.pollIntervalMs) config.server.pollIntervalMs = Math.min(300000, Math.max(5000, Number(body.server.pollIntervalMs)));
    }
    for (const kind of ["gateway", "modem"] as const) {
      const incoming = body.connection?.[kind];
      if (!incoming) continue;
      const target = config.connection[kind];
      for (const key of ["host", "user", "privateKeyPath", "hostFingerprint"] as const) if (incoming[key] !== undefined) (target[key] as string) = String(incoming[key]);
      if (incoming.port !== undefined) target.port = Math.min(65535, Math.max(1, Number(incoming.port)));
      if (typeof incoming.password === "string" && incoming.password) target.password = incoming.password;
      if (incoming.clearPassword) target.password = "";
      if (kind === "modem" && ["unifi", "manual"].includes(incoming.authMode)) config.connection.modem.authMode = incoming.authMode;
    }
    if (body.auth) {
      if (typeof body.auth.enabled === "boolean") config.auth.enabled = body.auth.enabled;
      if (typeof body.auth.viewerEnabled === "boolean") config.auth.viewerEnabled = body.auth.viewerEnabled;
      if (body.auth.adminPassword) setPassword("admin", String(body.auth.adminPassword));
      if (body.auth.viewerPassword) setPassword("viewer", String(body.auth.viewerPassword));
    }
    if (body.retention) Object.assign(config.retention, body.retention);
    if (body.notifications) {
      const current = config.notifications;
      Object.assign(current, body.notifications, {
        ntfy: { ...current.ntfy, ...body.notifications.ntfy },
        telegram: { ...current.telegram, ...body.notifications.telegram, botToken: body.notifications.telegram?.botToken || current.telegram.botToken },
        email: { ...current.email, ...body.notifications.email, password: body.notifications.email?.password || current.email.password },
      });
    }
    if (body.mqtt) Object.assign(config.mqtt, body.mqtt, { password: body.mqtt.password || config.mqtt.password });
    saveConfig();
    if (body.mqtt) applyMqtt();
    emitEvent({ ts: new Date().toISOString(), level: "action", kind: "settings", message: "Settings updated" });
    return publicConfig();
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/mqtt", async () => mqttState());
app.post("/api/mqtt/publish", async () => { if (currentStatus) publishStatus(currentStatus); return { ok: Boolean(currentStatus) }; });
app.post("/api/mqtt/discovery", async () => { publishDiscovery(); return { ok: true }; });
app.post("/api/notifications/test", async () => notify("UniFi U5G Monitor test", "Notifications are configured correctly."));
app.get("/api/diagnostics/live", async () => diagnostics());

app.get("/api/admin/health", async () => ({ startedAt: new Date(startedAt).toISOString(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), pollRunning: polling, lastStatusAt: currentStatus?.checkedAt, database: databaseStats(), mqtt: mqttState() }));
app.post("/api/admin/compact", async () => compact());
app.get("/api/admin/backup", async (_request, reply) => {
  reply.header("content-disposition", 'attachment; filename="u5g-monitor-settings-redacted.json"');
  return publicConfig();
});
app.get("/api/admin/diagnostics", async (_request, reply) => {
  reply.header("content-disposition", 'attachment; filename="u5g-diagnostics.json"');
  return { status: currentStatus, connection: await diagnostics(), health: { uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000), database: databaseStats() } };
});

app.get("/api/version", async () => {
  const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
  return { name: pkg.name, version: pkg.version, node: process.version, startedAt: new Date(startedAt).toISOString(), uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000) };
});

app.get("/ws", { websocket: true }, (socket) => {
  sockets.add(socket);
  if (currentStatus) socket.send(JSON.stringify({ type: "status", status: currentStatus }));
  socket.on("close", () => sockets.delete(socket));
});

const distDir = path.join(rootDir, "dist");
if (existsSync(distDir)) {
  await app.register(fastifyStatic, { root: distDir, prefix: "/" });
  app.setNotFoundHandler((request, reply) => request.raw.url?.startsWith("/api/") ? reply.code(404).send({ error: "Not found" }) : reply.sendFile("index.html"));
}

cleanup();
applyMqtt();
await poll();
setInterval(() => void poll(), config.server.pollIntervalMs);
setInterval(() => void runScheduled(automationActions), 30000);
setInterval(cleanup, 6 * 3600000);

await app.listen({ host: config.server.host, port: config.server.port });
console.log(`UniFi U5G Monitor listening on http://${config.server.host}:${config.server.port}`);
