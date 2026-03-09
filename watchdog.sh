#!/bin/bash
# copilot-remote watchdog
# Monitors the bot via Telegram API health check.
# On failure: kills stale processes, reverts dirty git state, restarts cleanly.
# Run as a detached process — inherits env from parent (needs COPILOT_REMOTE_BOT_TOKEN).

set -uo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG="$REPO/watchdog.log"
CHECK_INTERVAL=8     # seconds between health checks
FAIL_THRESHOLD=3     # consecutive failures before recovery
STARTUP_GRACE=20     # seconds to wait after restart before checking again

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"; }

health_check() {
  local token="${COPILOT_REMOTE_BOT_TOKEN:-}"
  if [ -z "$token" ]; then
    log "WARN: COPILOT_REMOTE_BOT_TOKEN not set — skipping Telegram health check"
    return 0
  fi
  local http_code
  http_code=$(curl -s -o /dev/null -w "%{http_code}" \
    --max-time 5 \
    "https://api.telegram.org/bot${token}/getMe")
  [ "$http_code" = "200" ]
}

kill_bot() {
  log "Killing any running bot processes..."
  pkill -f "tsx.*src/index" 2>/dev/null || true
  pkill -f "copilot-darwin-arm64/copilot --headless" 2>/dev/null || true
  sleep 2
}

revert_if_dirty() {
  cd "$REPO"
  if ! git diff --quiet || ! git diff --cached --quiet; then
    log "Dirty git state detected — reverting src/"
    git checkout -- src/ 2>&1 | tee -a "$LOG" || true
    git clean -fd src/ 2>&1 | tee -a "$LOG" || true
    log "Revert complete"
  else
    log "Git state clean — no revert needed"
  fi
}

start_bot() {
  cd "$REPO"
  log "Starting bot (tsx watch src/index.ts)..."
  nohup npx tsx watch src/index.ts >> "$REPO/bot.log" 2>&1 &
  local pid=$!
  echo "$pid" > "$REPO/.bot.pid"
  log "Bot started (PID $pid)"
}

recover() {
  log "=== RECOVERY TRIGGERED ==="
  kill_bot
  revert_if_dirty
  start_bot
  log "Recovery complete — waiting ${STARTUP_GRACE}s grace period..."
  sleep "$STARTUP_GRACE"
}

log "=== Watchdog started (PID $$, repo: $REPO) ==="
fail_count=0
heartbeat_count=0
HEARTBEAT_EVERY=6  # log "healthy" every N*CHECK_INTERVAL seconds (~48s)

while true; do
  if health_check; then
    if [ "$fail_count" -gt 0 ]; then
      log "Bot recovered (was failing for $((fail_count * CHECK_INTERVAL))s)"
    fi
    fail_count=0
    heartbeat_count=$((heartbeat_count + 1))
    if [ $((heartbeat_count % HEARTBEAT_EVERY)) -eq 0 ]; then
      log "Healthy (uptime checks: $heartbeat_count)"
    fi
  else
    fail_count=$((fail_count + 1))
    log "Health check failed ($fail_count/$FAIL_THRESHOLD)"
    if [ "$fail_count" -ge "$FAIL_THRESHOLD" ]; then
      recover
      fail_count=0
    fi
  fi
  sleep "$CHECK_INTERVAL"
done
