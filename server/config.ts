import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { AppConfig } from "./types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const rootDir = path.resolve(here, "..");
export const configPath = path.join(rootDir, "config", "settings.json");
export const dataDir = path.join(rootDir, "data");

mkdirSync(path.dirname(configPath), { recursive: true });
mkdirSync(dataDir, { recursive: true });

const defaults: AppConfig = {
  server: { host: "127.0.0.1", port: 8513, pollIntervalMs: 10000 },
  connection: {
    gateway: { host: "192.168.1.1", port: 22, user: "root", password: "", privateKeyPath: "", hostFingerprint: "" },
    modem: { host: "", port: 22, user: "", password: "", privateKeyPath: "", hostFingerprint: "", authMode: "unifi" },
  },
  auth: { enabled: true, adminHash: "", viewerHash: "", viewerEnabled: false, seededDefault: true },
  retention: { metricsDays: 30, eventsDays: 90, auditDays: 180, maxMetrics: 200000 },
  automation: { enabled: true, rules: [] },
  notifications: {
    enabled: false,
    incomingSms: true,
    connectionLost: true,
    ntfy: { enabled: false, url: "https://ntfy.sh", topic: "" },
    telegram: { enabled: false, botToken: "", chatId: "" },
    email: { enabled: false, host: "", port: 587, secure: false, user: "", password: "", from: "", to: "" },
  },
  mqtt: { enabled: false, url: "mqtt://127.0.0.1:1883", username: "", password: "", baseTopic: "unifi/u5g", homeAssistantDiscovery: false, discoveryPrefix: "homeassistant" },
};

function merge<T extends Record<string, unknown>>(base: T, value: Partial<T>): T {
  const out = { ...base } as Record<string, unknown>;
  for (const [key, next] of Object.entries(value ?? {})) {
    const prev = out[key];
    out[key] = next && typeof next === "object" && !Array.isArray(next) && prev && typeof prev === "object" && !Array.isArray(prev)
      ? merge(prev as Record<string, unknown>, next as Record<string, unknown>)
      : next;
  }
  return out as T;
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `${salt.toString("base64")}:${hash.toString("base64")}`;
}

export function verifyPassword(password: string, stored?: string): boolean {
  if (!stored?.includes(":")) return false;
  try {
    const [saltText, hashText] = stored.split(":");
    const expected = Buffer.from(hashText, "base64");
    const actual = scryptSync(password, Buffer.from(saltText, "base64"), expected.length);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function readConfig(): AppConfig {
  let loaded: Partial<AppConfig> = {};
  if (existsSync(configPath)) loaded = JSON.parse(readFileSync(configPath, "utf8"));
  const next = merge(defaults as unknown as Record<string, unknown>, loaded as unknown as Record<string, unknown>) as unknown as AppConfig;
  if (!next.auth.adminHash) {
    next.auth.adminHash = hashPassword("admin");
    next.auth.seededDefault = true;
  }
  writeFileSync(configPath, JSON.stringify(next, null, 2));
  if (process.env.U5G_HOST) next.server.host = process.env.U5G_HOST;
  if (process.env.U5G_PORT) next.server.port = Number(process.env.U5G_PORT);
  return next;
}

export const config = readConfig();

export function saveConfig() {
  writeFileSync(configPath, JSON.stringify(config, null, 2));
}

export function setPassword(kind: "admin" | "viewer", password: string) {
  const hash = hashPassword(password);
  if (kind === "admin") {
    config.auth.adminHash = hash;
    config.auth.seededDefault = false;
  } else {
    config.auth.viewerHash = hash;
    config.auth.viewerEnabled = true;
  }
}

export function readPrivateKey(target: { privateKeyPath?: string }) {
  if (!target.privateKeyPath) return undefined;
  const full = path.isAbsolute(target.privateKeyPath) ? target.privateKeyPath : path.join(rootDir, target.privateKeyPath);
  return existsSync(full) ? readFileSync(full) : undefined;
}

export function publicConfig() {
  return {
    server: config.server,
    connection: {
      gateway: { ...config.connection.gateway, password: undefined, passwordSet: Boolean(config.connection.gateway.password), privateKeySet: Boolean(config.connection.gateway.privateKeyPath) },
      modem: { ...config.connection.modem, password: undefined, passwordSet: Boolean(config.connection.modem.password), privateKeySet: Boolean(config.connection.modem.privateKeyPath) },
    },
    auth: { enabled: config.auth.enabled, viewerEnabled: config.auth.viewerEnabled, seededDefault: config.auth.seededDefault },
    retention: config.retention,
    automation: config.automation,
    notifications: {
      ...config.notifications,
      telegram: { ...config.notifications.telegram, botToken: undefined, tokenSet: Boolean(config.notifications.telegram.botToken) },
      email: { ...config.notifications.email, password: undefined, passwordSet: Boolean(config.notifications.email.password) },
    },
    mqtt: { ...config.mqtt, password: undefined, passwordSet: Boolean(config.mqtt.password) },
  };
}
