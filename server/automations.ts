import { config, saveConfig } from "./config.js";
import { emitEvent, recordAutomationRun } from "./database.js";
import { notify } from "./notifications.js";
import { publishAutomation } from "./mqtt.js";
import type { AutomationRule } from "./types.js";

export type AutomationActions = { send: (number: string, text: string) => Promise<{ ok: boolean; message: string }> };

function runsToday(ruleId: string) {
  // The persisted counters live in automation_runs; for rate limiting this
  // process-local window is enough and is rebuilt naturally after restart.
  const list = recentRuns.get(ruleId) ?? [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return list.filter((time) => time >= start.getTime());
}

const recentRuns = new Map<string, number[]>();

function canRun(rule: AutomationRule) {
  const last = rule.lastRunAt ? Date.parse(rule.lastRunAt) : 0;
  if (last && Date.now() - last < rule.cooldownMs) return { ok: false, reason: "Cooldown active" };
  if (runsToday(rule.id).length >= rule.maxPerDay) return { ok: false, reason: "Daily limit reached" };
  return { ok: true, reason: "Ready" };
}

async function execute(rule: AutomationRule, context: { smsId?: string; sender?: string; text?: string }, actions: AutomationActions) {
  const gate = canRun(rule);
  if (!gate.ok) {
    recordAutomationRun(rule.id, "skipped", gate.reason, context.smsId);
    return gate;
  }
  let outcome = { ok: false, reason: "Unsupported action" };
  if (rule.action === "reply") {
    if (!context.sender || !rule.message) outcome = { ok: false, reason: "Sender or reply text missing" };
    else {
      const result = await actions.send(context.sender, rule.message);
      outcome = { ok: result.ok, reason: result.message };
    }
  } else if (rule.action === "send_sms") {
    if (!rule.destination || !rule.message) outcome = { ok: false, reason: "Destination or message missing" };
    else {
      const result = await actions.send(rule.destination, rule.message);
      outcome = { ok: result.ok, reason: result.message };
    }
  } else if (rule.action === "notify") {
    const result = await notify(`U5G automation: ${rule.name}`, context.text || rule.message || "Rule triggered");
    outcome = { ok: result.sent > 0, reason: result.sent > 0 ? `Delivered to ${result.sent} channel(s)` : result.errors[0] || "No notification channel enabled" };
  } else if (rule.action === "mqtt") {
    outcome = { ok: publishAutomation(rule.id, context), reason: "Published to MQTT" };
  }
  rule.lastRunAt = new Date().toISOString();
  if (context.smsId) rule.lastMatchedSmsId = context.smsId;
  recentRuns.set(rule.id, [...runsToday(rule.id), Date.now()]);
  saveConfig();
  recordAutomationRun(rule.id, outcome.ok ? "ok" : "failed", outcome.reason, context.smsId);
  emitEvent({ ts: new Date().toISOString(), level: outcome.ok ? "action" : "error", kind: "automation", message: `${rule.name}: ${outcome.reason}`, data: { ruleId: rule.id, smsId: context.smsId } });
  return outcome;
}

export async function evaluateIncomingSms(sms: { id: string; from?: string; text?: string }, actions: AutomationActions) {
  if (!config.automation.enabled) return;
  for (const rule of config.automation.rules) {
    if (!rule.enabled || rule.trigger !== "incoming_sms" || rule.lastMatchedSmsId === sms.id) continue;
    if (rule.senderContains && !String(sms.from ?? "").toLowerCase().includes(rule.senderContains.toLowerCase())) continue;
    if (rule.textContains && !String(sms.text ?? "").toLowerCase().includes(rule.textContains.toLowerCase())) continue;
    await execute(rule, { smsId: sms.id, sender: sms.from, text: sms.text }, actions);
  }
}

export async function runScheduled(actions: AutomationActions) {
  if (!config.automation.enabled) return;
  const current = new Date();
  const hhmm = `${String(current.getHours()).padStart(2, "0")}:${String(current.getMinutes()).padStart(2, "0")}`;
  for (const rule of config.automation.rules) {
    if (!rule.enabled || rule.trigger !== "scheduled" || rule.schedule !== hhmm) continue;
    if (rule.lastRunAt?.slice(0, 10) === new Date().toISOString().slice(0, 10)) continue;
    await execute(rule, {}, actions);
  }
}

export async function runRuleNow(id: string, actions: AutomationActions) {
  const rule = config.automation.rules.find((item) => item.id === id);
  if (!rule) return { ok: false, reason: "Rule not found" };
  return execute(rule, {}, actions);
}

export function dryRun(rule: AutomationRule) {
  const gate = canRun(rule);
  const valid = rule.trigger === "incoming_sms" ? Boolean(rule.senderContains || rule.textContains) : /^\d{2}:\d{2}$/.test(rule.schedule || "");
  const actionReady = rule.action === "reply" ? Boolean(rule.message) : rule.action === "send_sms" ? Boolean(rule.destination && rule.message) : true;
  return { valid, actionReady, cooldownReady: gate.ok, reason: !valid ? "Trigger is incomplete" : !actionReady ? "Action is incomplete" : gate.reason, wouldRun: valid && actionReady && gate.ok };
}
