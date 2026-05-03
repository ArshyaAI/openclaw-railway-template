#!/usr/bin/env bash
set -euo pipefail

restore_persisted_crons() {
  local source_dir="/data/.openclaw/cron/system"
  [ -d "$source_dir" ] || return 0

  while IFS= read -r cron_file; do
    local name
    name="$(basename "$cron_file")"
    case "$name" in
      ""|*[^A-Za-z0-9_.-]*)
        echo "[start-astack] skipping invalid cron file name: $name" >&2
        continue
        ;;
    esac
    cp "$cron_file" "/etc/cron.d/$name"
    chmod 0644 "/etc/cron.d/$name"
    echo "[start-astack] restored cron file /etc/cron.d/$name"
  done < <(find "$source_dir" -maxdepth 1 -type f | sort)
}

start_cron() {
  if command -v service >/dev/null 2>&1; then
    service cron start >/dev/null 2>&1 || true
  fi
  if ! pgrep -x cron >/dev/null 2>&1; then
    cron >/dev/null 2>&1 || true
  fi
}

start_gbrain_supervisor() {
  local gbrain_bin="/data/.bun/bin/gbrain"
  local gbrain_dir="/data/gbrain"
  local pid_file="/data/.gbrain/supervisor.pid"

  if [ ! -x "$gbrain_bin" ] || [ ! -d "$gbrain_dir" ]; then
    echo "[start-astack] gbrain not installed; skipping supervisor start"
    return 0
  fi

  export HOME=/data
  export GBRAIN_HOME=/data
  export BRAIN_REPO=/data/brain
  export BUN_INSTALL=/data/.bun
  export PATH="/data/.bun/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

  if "$gbrain_bin" jobs supervisor status --json >/tmp/gbrain-supervisor-status.json 2>/tmp/gbrain-supervisor-status.err; then
    echo "[start-astack] gbrain supervisor already running"
    return 0
  fi

  rm -f "$pid_file"
  if (cd "$gbrain_dir" && "$gbrain_bin" jobs supervisor start --detach --json --allow-shell-jobs); then
    echo "[start-astack] gbrain supervisor started"
  else
    echo "[start-astack] warning: failed to start gbrain supervisor" >&2
    sed -n '1,20p' /tmp/gbrain-supervisor-status.err >&2 || true
  fi
}

configure_openclaw_gbrain_mcp() {
  local openclaw_bin="/app/node_modules/.bin/openclaw"
  local gbrain_bin="/data/.bun/bin/gbrain"

  if [ ! -x "$openclaw_bin" ] || [ ! -x "$gbrain_bin" ]; then
    echo "[start-astack] OpenClaw or GBrain binary missing; skipping MCP config"
    return 0
  fi

  export HOME=/data
  export GBRAIN_HOME=/data
  export BRAIN_REPO=/data/brain
  export BUN_INSTALL=/data/.bun
  export PATH="/data/.bun/bin:/app/node_modules/.bin:/usr/local/bin:/usr/bin:/bin:$PATH"

  if "$openclaw_bin" mcp set gbrain '{"command":"/data/.bun/bin/gbrain","args":["serve"]}' >/tmp/openclaw-gbrain-mcp-set.log 2>&1; then
    echo "[start-astack] ensured OpenClaw gbrain MCP server"
  else
    echo "[start-astack] warning: failed to ensure OpenClaw gbrain MCP server" >&2
    sed -n '1,20p' /tmp/openclaw-gbrain-mcp-set.log >&2 || true
  fi

  if "$openclaw_bin" config unset plugins.entries.device-pair >/tmp/openclaw-device-pair-unset.log 2>&1; then
    echo "[start-astack] removed stale device-pair config entry"
  elif grep -Eiq 'not found|missing|does not exist|no such' /tmp/openclaw-device-pair-unset.log 2>/dev/null; then
    echo "[start-astack] stale device-pair config entry already absent"
  else
    echo "[start-astack] warning: failed to remove stale device-pair config entry" >&2
    sed -n '1,20p' /tmp/openclaw-device-pair-unset.log >&2 || true
  fi
}

restore_persisted_crons
start_cron
start_gbrain_supervisor
configure_openclaw_gbrain_mcp

exec alphaclaw start
