import { Client, type ConnectConfig, type ClientChannel } from "ssh2";
import { readPrivateKey } from "./config.js";
import type { SshTarget } from "./types.js";

export const observedFingerprints: { gateway?: string; modem?: string } = {};

function fingerprintMatches(actualHex: string, expected?: string): boolean {
  if (!expected?.trim()) return true;
  const clean = expected.trim();
  if (clean.toLowerCase() === actualHex.toLowerCase()) return true;
  const base64 = Buffer.from(actualHex, "hex").toString("base64").replace(/=+$/, "");
  return clean.replace(/^SHA256:/i, "").replace(/=+$/, "") === base64;
}

function connectConfig(target: SshTarget, sock: ClientChannel | undefined, kind: "gateway" | "modem"): ConnectConfig {
  return {
    host: sock ? undefined : target.host,
    port: sock ? undefined : target.port,
    sock,
    username: target.user,
    password: target.password || undefined,
    tryKeyboard: Boolean(target.password),
    privateKey: readPrivateKey(target),
    readyTimeout: 10000,
    keepaliveInterval: 10000,
    keepaliveCountMax: 2,
    hostHash: "sha256",
    hostVerifier: (actual: string) => {
      observedFingerprints[kind] = `SHA256:${Buffer.from(actual, "hex").toString("base64").replace(/=+$/, "")}`;
      return fingerprintMatches(actual, target.hostFingerprint);
    },
    algorithms: { serverHostKey: ["ssh-ed25519", "rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"] },
  };
}

function connect(target: SshTarget, sock?: ClientChannel, kind: "gateway" | "modem" = "gateway"): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("keyboard-interactive", (_name, _instructions, _lang, prompts, finish) => {
      finish(prompts.map(() => target.password ?? ""));
    });
    client.once("ready", () => resolve(client));
    client.once("error", reject);
    client.connect(connectConfig(target, sock, kind));
  });
}

export function exec(client: Client, command: string, timeoutMs = 12000): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) reject(new Error(`Command timeout after ${timeoutMs}ms`));
    }, timeoutMs);
    client.exec(command, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      let stdout = "";
      let stderr = "";
      stream.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      stream.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
      stream.on("close", (code: number | null) => {
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
  });
}

export async function withGateway<T>(target: SshTarget, work: (client: Client) => Promise<T>): Promise<T> {
  const gateway = await connect(target, undefined, "gateway");
  try {
    return await work(gateway);
  } finally {
    gateway.end();
  }
}

export async function withJump<T>(gatewayTarget: SshTarget, modemTarget: SshTarget, work: (client: Client) => Promise<T>): Promise<T> {
  const gateway = await connect(gatewayTarget, undefined, "gateway");
  let modem: Client | undefined;
  try {
    const tunnel = await new Promise<ClientChannel>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`U5G SSH tunnel timeout (${modemTarget.host}:${modemTarget.port})`));
      }, 10000);
      gateway.forwardOut("127.0.0.1", 0, modemTarget.host, modemTarget.port, (error, stream) => {
        clearTimeout(timer);
        if (timedOut) { stream?.end(); return; }
        if (error) reject(error);
        else resolve(stream);
      });
    });
    modem = await connect(modemTarget, tunnel, "modem");
    return await work(modem);
  } finally {
    modem?.end();
    gateway.end();
  }
}
