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
  releaseUrl?: string;
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

async function latestFromReleases(): Promise<{ version: string; url: string } | null> {
  const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    signal: AbortSignal.timeout(8000),
    headers: { accept: "application/vnd.github+json" },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const release = (await response.json()) as { tag_name?: string; html_url?: string };
  const version = String(release.tag_name || "").replace(/^v/i, "");
  return version ? { version, url: release.html_url || `https://github.com/${REPO}/releases` } : null;
}

async function latestFromPackageJson(): Promise<{ version: string; url: string } | null> {
  const response = await fetch(`https://raw.githubusercontent.com/${REPO}/master/package.json`, { signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const remote = (await response.json()) as { version?: string };
  const version = String(remote.version || "");
  return version ? { version, url: `https://github.com/${REPO}` } : null;
}

export async function checkForUpdate(): Promise<UpdateState> {
  try {
    const latest = (await latestFromReleases()) ?? (await latestFromPackageJson());
    state = {
      ...state,
      latestVersion: latest?.version,
      updateAvailable: latest ? isNewer(latest.version, currentVersion) : false,
      releaseUrl: latest?.url,
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
