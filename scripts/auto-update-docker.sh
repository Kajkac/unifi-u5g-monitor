#!/usr/bin/env bash
# Checks the git remote for new commits and, if found, pulls and rebuilds the
# Docker Compose deployment in place. Safe to run repeatedly via cron/systemd
# timer — it's a no-op when already up to date. Uses a mkdir-based lock (portable
# to macOS/BSD, unlike flock) to avoid overlapping runs; stale locks older than
# 30 minutes are treated as crashed runs and cleared.
set -euo pipefail

# cron/systemd run with a minimal PATH — make sure Homebrew/local git & docker are found.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCK_DIR="$ROOT_DIR/.auto-update.lock"
LOG_FILE="$ROOT_DIR/logs/auto-update.log"
mkdir -p "$ROOT_DIR/logs"

log() { echo "$(date -u +%FT%TZ) $*" >>"$LOG_FILE"; }

if [ -d "$LOCK_DIR" ]; then
  if [ -n "$(find "$LOCK_DIR" -maxdepth 0 -mmin +30 2>/dev/null)" ]; then
    log "clearing stale lock"
    rm -rf "$LOCK_DIR"
  else
    log "already running, skipping"
    exit 0
  fi
fi
mkdir "$LOCK_DIR"
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT

cd "$ROOT_DIR"

git fetch --quiet origin master
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/master)

if [ "$LOCAL" = "$REMOTE" ]; then
  log "up to date ($LOCAL)"
  exit 0
fi

log "update found: $LOCAL -> $REMOTE"
if git pull --ff-only origin master >>"$LOG_FILE" 2>&1 \
  && docker compose up -d --build >>"$LOG_FILE" 2>&1; then
  log "updated and restarted successfully"
else
  log "update FAILED — check the log above; repo/container left as-is"
  exit 1
fi
