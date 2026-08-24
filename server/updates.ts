import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { rootDir } from "./config.js";

const exec = promisify(execFile);
const REPO = "Kajkac/unifi-u5g-monitor";

const pkg = JSON.parse(readFileSync(path.join(rootDir, "package.json"), "utf8"));
export const currentVersion: string = pkg.version;
const canSelfUpdate = existsSync(path.join(rootDir, ".git"));

type UpdateState = {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  checkedAt?: string;
  error?: string;
  canSelfUpdate: boolean;
};

let state: UpdateState = { currentVersion, updateAvailable: false, canSelfUpdate };

function isNewer(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => Number(n) || 0);
  const b = current.split(".").map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) > (b[i] || 0)) return true;
    if ((a[i] || 0) < (b[i] || 0)) return false;
  }
  return false;
}

export function getUpdateState(): UpdateState {
  return state;
}

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const response = await fetch(`https://raw.githubusercontent.com/${REPO}/master/package.json`, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const remote = (await response.json()) as { version?: string };
    const latestVersion = String(remote.version || "");
    state = {
      ...state,
      latestVersion: latestVersion || undefined,
      updateAvailable: latestVersion ? isNewer(latestVersion, currentVersion) : false,
      checkedAt: new Date().toISOString(),
      error: undefined,
    };
  } catch (error) {
    state = { ...state, checkedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) };
  }
  return state;
}

export function getChangelog(): string {
  const file = path.join(rootDir, "CHANGELOG.md");
  return existsSync(file) ? readFileSync(file, "utf8") : "";
}

export async function applyUpdate(): Promise<{ ok: boolean; message: string; log?: string }> {
  if (!state.canSelfUpdate) {
    return { ok: false, message: "This deployment has no local git checkout (e.g. a Docker image). Update on the host instead: git pull && docker compose up -d --build" };
  }
  try {
    const pull = await exec("git", ["pull", "--ff-only"], { cwd: rootDir, timeout: 60000 });
    const install = await exec("npm", ["ci"], { cwd: rootDir, timeout: 300000 });
    const build = await exec("npm", ["run", "build"], { cwd: rootDir, timeout: 300000 });
    return { ok: true, message: "Update installed. Restarting…", log: [pull.stdout, install.stdout, build.stdout].join("\n").slice(-4000) };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, message: err.stderr?.trim() || err.message || "Update failed", log: err.stdout };
  }
}
