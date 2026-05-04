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

install_astack_direct_minions_runtime() {
  local source_dir="/app/patches"
  local target_dir="/data/.openclaw/cron/bin"
  local stamp

  [ -d "$source_dir" ] || return 0
  mkdir -p "$target_dir"
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"

  install_one() {
    local name="$1"
    local mode="$2"
    local src="$source_dir/$name"
    local dest="$target_dir/$name"

    [ -f "$src" ] || return 0
    if [ -f "$dest" ] && ! cmp -s "$src" "$dest"; then
      cp -p "$dest" "$dest.bak.astack-$stamp"
      echo "[start-astack] backed up existing direct-minions runtime $dest"
    fi
    if [ ! -f "$dest" ] || ! cmp -s "$src" "$dest"; then
      cp "$src" "$dest"
      chmod "$mode" "$dest"
      echo "[start-astack] installed astack direct-minions runtime $dest"
    fi
  }

  install_one "direct-minions-scheduler.mjs" 0755
  install_one "openclaw-agent-job.sh" 0755
}

load_persistent_env() {
  local env_file="/data/.env"

  [ -f "$env_file" ] || return 0

  local export_file
  export_file="$(mktemp /tmp/astack-env.XXXXXX)"

  if node - "$env_file" >"$export_file" <<'NODE'
const fs = require("fs");
const file = process.argv[2];

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith("#")) continue;

  const body = line.startsWith("export ") ? line.slice(7).trim() : line;
  const match = body.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!match) continue;

  const [, key, rawValue] = match;
  let value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  if (!value) continue;

  console.log(`if [ -z "\${${key}:-}" ]; then export ${key}=${shellQuote(value)}; fi`);
}
NODE
  then
    # shellcheck disable=SC1090
    . "$export_file"
    echo "[start-astack] loaded persistent runtime environment"
  else
    echo "[start-astack] warning: failed to parse persistent runtime environment" >&2
  fi

  rm -f "$export_file"
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

patch_alphaclaw_gbrain_boot_config() {
  local alphaclaw_bin="/app/node_modules/@chrysb/alphaclaw/bin/alphaclaw.js"

  if [ ! -f "$alphaclaw_bin" ]; then
    echo "[start-astack] AlphaClaw binary missing; skipping boot config patch"
    return 0
  fi

  node - "$alphaclaw_bin" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const marker = "codexEnsureGbrainMcpBootConfig";
let source = fs.readFileSync(file, "utf8");

if (source.includes(marker)) {
  console.log("[start-astack] AlphaClaw boot config patch already present");
  process.exit(0);
}

const needle = "    bootRestoreConfigFromRemote();";
if (!source.includes(needle)) {
  console.error("[start-astack] AlphaClaw boot config patch point not found");
  process.exit(1);
}

const patch = `
    const codexEnsureGbrainMcpBootConfig = () => {
      try {
        const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
        if (!cfg.mcp || typeof cfg.mcp !== "object" || Array.isArray(cfg.mcp)) cfg.mcp = {};
        if (!cfg.mcp.servers || typeof cfg.mcp.servers !== "object" || Array.isArray(cfg.mcp.servers)) cfg.mcp.servers = {};
        cfg.mcp.servers.gbrain = { command: "/data/.bun/bin/gbrain", args: ["serve"] };
        if (cfg.plugins?.entries && Object.hasOwn(cfg.plugins.entries, "device-pair")) {
          delete cfg.plugins.entries["device-pair"];
        }
        fs.writeFileSync(configPath, JSON.stringify(cfg, null, 2) + "\\n");
        console.log("[alphaclaw] Ensured GBrain MCP boot config");
      } catch (e) {
        console.log(\`[alphaclaw] GBrain MCP boot config skipped: \${String(e.message || "").slice(0, 200)}\`);
      }
    };
`;

source = source.replace(needle, `${patch}${needle}
    codexEnsureGbrainMcpBootConfig();`);
fs.writeFileSync(file, source);
console.log("[start-astack] patched AlphaClaw boot config reconciliation");
NODE
}

schedule_post_boot_openclaw_gbrain_mcp() {
  (
    for delay in 5 10 20 40; do
      sleep "$delay"
      configure_openclaw_gbrain_mcp
      if /app/node_modules/.bin/openclaw mcp list 2>/tmp/openclaw-mcp-list.log | grep -q '^- gbrain'; then
        echo "[start-astack] post-boot gbrain MCP config verified"
        exit 0
      fi
    done
    echo "[start-astack] warning: post-boot gbrain MCP verification did not pass" >&2
    sed -n '1,20p' /tmp/openclaw-mcp-list.log >&2 || true
  ) &
}

install_astack_direct_minions_runtime
restore_persisted_crons
start_cron
load_persistent_env
start_gbrain_supervisor
configure_openclaw_gbrain_mcp
patch_alphaclaw_gbrain_boot_config
schedule_post_boot_openclaw_gbrain_mcp

exec alphaclaw start
