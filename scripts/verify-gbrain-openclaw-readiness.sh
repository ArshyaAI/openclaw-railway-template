#!/usr/bin/env bash
set -euo pipefail

TARGET_PROJECT_ID="fbdb217b-060f-4f1e-8697-08a6288a19c4"
TARGET_ENVIRONMENT="production"
TARGET_ENVIRONMENT_ID="614198f2-f7ed-4756-ae83-e0dd23943c9d"
TARGET_SERVICE_ID="6f333a2b-07d9-4219-8531-3b96fbc6a2f9"
TARGET_SERVICE_NAME="openclaw-railway-template"
FORBIDDEN_SERVICE_ID="63b84308-25d7-4b03-9c23-4d0d7239728f"
UPSTREAM_GBRAIN_SHA="9e2093fc9bb6cb46520e58b0c95b807e788d9606"

usage() {
  cat <<'EOF'
Usage:
  npm run verify:gbrain -- --help
  npm run verify:gbrain -- --local
  npm run verify:gbrain -- --railway
  npm run verify:gbrain -- --railway-current
  npm run verify:gbrain -- --runtime-readonly
  npm run verify:gbrain -- --dead-jobs-readonly
  npm run verify:gbrain -- --gbrain-install-readonly

Modes:
  --local     Read local repo pins and safe local CLI health summaries.
  --railway   Read target Railway service status, deployment history, and
              filtered logs using a temporary CLI link.
  --railway-current
              Read the target Railway service status and summarize recent risk
              logs from the last GBRAIN_VERIFY_SINCE window (default: 10m).
  --runtime-readonly
              SSH into the target service and run redacted read-only runtime
              diagnostics. Does not print env vars or secret values.
  --dead-jobs-readonly
              SSH into the target service and print metadata/error summaries
              for recent dead GBrain jobs. Does not print payload/stdout/stderr.
  --gbrain-install-readonly
              SSH into the target service and print the active GBrain wrapper,
              git checkout, package version, and binary version. No env dump.

Safety:
  This verifier never reads Railway variables and never deploys, restarts,
  migrates, edits cron, opens tunnels, creates OAuth clients, or runs an
  OpenClaw agent canary.
EOF
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "FAIL missing command: $1" >&2
    exit 1
  fi
}

count_matches() {
  local pattern="$1"
  local file="$2"
  local count
  count="$(rg -ci "$pattern" "$file" 2>/dev/null || true)"
  if [[ -z "$count" ]]; then
    echo "0"
  else
    echo "$count"
  fi
}

redact_sensitive() {
  sed -E \
    -e 's/^([A-Za-z0-9_]*(TOKEN|KEY|SECRET|PASSWORD|PASS|AUTH|SID|COOKIE|CREDENTIAL|DATABASE)[A-Za-z0-9_]*=).*/\1REDACTED/g' \
    -e 's/(conn|instance|runId|profile)=([^ ]+)/\1=REDACTED/g' \
    -e 's/(Bearer )[A-Za-z0-9._-]+/\1REDACTED/g' \
    -e 's/(OPENAI_API_KEY|ANTHROPIC_API_KEY|DATABASE_URL)=([^ ]+)/\1=REDACTED/g' \
    -e 's#postgres(ql)?://[^ ]+#POSTGRES_URL_REDACTED#g' \
    -e 's/sk-[A-Za-z0-9]{20,}/sk-REDACTED/g' \
    -e 's/xox[baprs]-[A-Za-z0-9-]{20,}/xox-REDACTED/g' \
    -e 's/gh[pousr]_[A-Za-z0-9]{20,}/gh_REDACTED/g'
}

assert_target_service_status() {
  node -e '
const fs = require("fs");
const expectedId = process.argv[1];
const expectedName = process.argv[2];
const service = JSON.parse(fs.readFileSync(0, "utf8"));
if (service.id !== expectedId || service.name !== expectedName) {
  console.error(`FAIL wrong Railway service: got ${service.name} (${service.id})`);
  process.exit(2);
}
console.log(`verified_target=${service.name} (${service.id})`);
' "$TARGET_SERVICE_ID" "$TARGET_SERVICE_NAME"
}

make_tmpdir() {
  local tmpbase
  tmpbase="${GBRAIN_VERIFY_TMPDIR:-}"
  if [[ -z "$tmpbase" ]]; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      tmpbase="/private/tmp"
    else
      tmpbase="${TMPDIR:-/tmp}"
    fi
  fi
  mkdir -p "$tmpbase"
  mktemp -d "$tmpbase/gbrain-railway-readonly.XXXXXX"
}

json_package_value() {
  node -e "const p=require('./package.json'); const path=process.argv[1].split('.'); let v=p; for (const k of path) v=v?.[k]; console.log(v ?? '')" "$1"
}

run_local() {
  require_command node

  echo "== local repo =="
  echo "package.name=$(json_package_value name)"
  echo "package.version=$(json_package_value version)"
  echo "dependency.@chrysb/alphaclaw=$(json_package_value 'dependencies.@chrysb/alphaclaw')"
  echo "override.openclaw=$(json_package_value 'overrides.openclaw')"
  echo "upstream.gbrain.sha=$UPSTREAM_GBRAIN_SHA"

  local_gbrain="$(command -v gbrain 2>/dev/null || true)"
  if [[ -n "$local_gbrain" && -x "$local_gbrain" ]]; then
    echo "== local gbrain =="
    "$local_gbrain" --version || true
    "$local_gbrain" doctor --fast --json || true
  else
    echo "WARN local gbrain not executable on PATH"
  fi

  if command -v openclaw >/dev/null 2>&1; then
    echo "== local openclaw =="
    openclaw --version || true
  else
    echo "WARN local openclaw not found on PATH"
  fi
}

run_railway() {
  require_command railway
  require_command rg
  require_command node

  if [[ "$TARGET_SERVICE_ID" == "$FORBIDDEN_SERVICE_ID" ]]; then
    echo "REFUSING forbidden service id: $FORBIDDEN_SERVICE_ID" >&2
    exit 2
  fi

  tmpdir="$(make_tmpdir)"
  trap 'rm -rf "$tmpdir"' EXIT

  echo "== railway target =="
  echo "project=$TARGET_PROJECT_ID"
  echo "environment=$TARGET_ENVIRONMENT ($TARGET_ENVIRONMENT_ID)"
  echo "service=$TARGET_SERVICE_NAME ($TARGET_SERVICE_ID)"

  (
    cd "$tmpdir"
    railway link \
      --project "$TARGET_PROJECT_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --service "$TARGET_SERVICE_ID" \
      --json

    echo "== service status =="
    service_status_json="$(railway service status \
      --service "$TARGET_SERVICE_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --json)"
    printf '%s\n' "$service_status_json" | assert_target_service_status
    printf '%s\n' "$service_status_json"

    echo "== latest deployments =="
    railway deployment list \
      --service "$TARGET_SERVICE_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --json \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const xs=JSON.parse(s); for (const d of xs.slice(0,5)) console.log(`${d.id}\t${d.status}\t${d.createdAt}\t${d.meta?.cliMessage || d.meta?.commitMessage || ""}`);})'

    echo "== filtered risk logs =="
    raw_log="$tmpdir/raw-logs.txt"
    risk_log="$tmpdir/risk-logs.txt"
    railway logs \
      --service "$TARGET_SERVICE_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --lines 500 \
      > "$raw_log"

    rg -i "token_mismatch|sessions/store|prolite|rate limit|gbrain|direct-minions|supervisor|cron|error|warn" \
      "$raw_log" > "$risk_log" || true

    total_matches="$(wc -l < "$risk_log" | tr -d ' ')"
    token_mismatch_matches="$(count_matches "token_mismatch" "$risk_log")"
    session_store_matches="$(count_matches "sessions/store" "$risk_log")"
    rate_limit_matches="$(count_matches "prolite|rate limit" "$risk_log")"

    echo "matching_lines=$total_matches"
    echo "token_mismatch_lines=$token_mismatch_matches"
    echo "sessions_store_lines=$session_store_matches"
    echo "rate_limit_lines=$rate_limit_matches"
    echo "last_matching_lines="
    tail -40 "$risk_log" | redact_sensitive
  )
}

run_railway_current() {
  require_command railway
  require_command rg
  require_command node

  if [[ "$TARGET_SERVICE_ID" == "$FORBIDDEN_SERVICE_ID" ]]; then
    echo "REFUSING forbidden service id: $FORBIDDEN_SERVICE_ID" >&2
    exit 2
  fi

  tmpdir="$(make_tmpdir)"
  trap 'rm -rf "$tmpdir"' EXIT
  since="${GBRAIN_VERIFY_SINCE:-10m}"

  echo "== railway current target =="
  echo "project=$TARGET_PROJECT_ID"
  echo "environment=$TARGET_ENVIRONMENT ($TARGET_ENVIRONMENT_ID)"
  echo "service=$TARGET_SERVICE_NAME ($TARGET_SERVICE_ID)"
  echo "since=$since"

  (
    cd "$tmpdir"
    railway link \
      --project "$TARGET_PROJECT_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --service "$TARGET_SERVICE_ID" \
      --json

    echo "== service status =="
    service_status_json="$(railway service status \
      --service "$TARGET_SERVICE_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --json)"
    printf '%s\n' "$service_status_json" | assert_target_service_status
    printf '%s\n' "$service_status_json"

    echo "== current risk log summary =="
    raw_log="$tmpdir/current-logs.txt"
    railway logs \
      --service "$TARGET_SERVICE_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --since "$since" \
      --lines 500 \
      > "$raw_log"

    total_lines="$(wc -l < "$raw_log" | tr -d ' ')"
    token_mismatch_matches="$(count_matches "token_mismatch" "$raw_log")"
    session_store_matches="$(count_matches "sessions/store" "$raw_log")"
    rate_limit_matches="$(count_matches "prolite|rate limit|usage limit|FailoverError" "$raw_log")"

    echo "current_total_lines=$total_lines"
    echo "current_token_mismatch_lines=$token_mismatch_matches"
    echo "current_sessions_store_lines=$session_store_matches"
    echo "current_rate_limit_lines=$rate_limit_matches"
    echo "current_matching_lines="
    rg -i "token_mismatch|sessions/store|prolite|rate limit|usage limit|FailoverError" "$raw_log" \
      | tail -40 \
      | redact_sensitive || true
  )
}

run_runtime_readonly() {
  require_command railway
  require_command rg

  if [[ "$TARGET_SERVICE_ID" == "$FORBIDDEN_SERVICE_ID" ]]; then
    echo "REFUSING forbidden service id: $FORBIDDEN_SERVICE_ID" >&2
    exit 2
  fi

  echo "== runtime readonly target =="
  echo "project=$TARGET_PROJECT_ID"
  echo "environment=$TARGET_ENVIRONMENT ($TARGET_ENVIRONMENT_ID)"
  echo "service=$TARGET_SERVICE_NAME ($TARGET_SERVICE_ID)"

  ssh_target() {
    local remote_command
    remote_command="$*"
    railway ssh \
      --project "$TARGET_PROJECT_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --service "$TARGET_SERVICE_ID" \
      "env HOME=/data GBRAIN_HOME=/data BRAIN_REPO=/data/brain BUN_INSTALL=/data/.bun PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin $remote_command"
  }

  run_step() {
    local label="$1"
    shift
    local output
    local attempt
    echo "== $label =="
    for attempt in 1 2 3; do
      if output="$(ssh_target "$@" 2>&1)"; then
        printf '%s\n' "$output" | redact_sensitive
        sleep 1
        return 0
      fi
      if [[ "$attempt" == "3" ]]; then
        printf '%s\n' "$output" | redact_sensitive
        echo "FAIL runtime read-only command failed: $label" >&2
        exit 1
      fi
      echo "WARN retrying runtime read-only command: $label (attempt $attempt)" >&2
      sleep 3
    done
  }

  run_step_filtered() {
    local label="$1"
    local pattern="$2"
    shift 2
    local output
    local attempt
    echo "== $label =="
    for attempt in 1 2 3; do
      if output="$(ssh_target "$@" 2>&1)"; then
        printf '%s\n' "$output" \
          | redact_sensitive \
          | rg -i "$pattern" \
          | head -120 || true
        sleep 1
        return 0
      fi
      if [[ "$attempt" == "3" ]]; then
        printf '%s\n' "$output" | redact_sensitive
        echo "FAIL runtime read-only command failed: $label" >&2
        exit 1
      fi
      echo "WARN retrying runtime read-only command: $label (attempt $attempt)" >&2
      sleep 3
    done
  }

  run_optional_step() {
    local label="$1"
    shift
    local output
    echo "== $label =="
    if output="$(ssh_target "$@" 2>&1)"; then
      printf '%s\n' "$output" | redact_sensitive
    else
      printf '%s\n' "$output" | redact_sensitive
      echo "WARN optional runtime read-only command failed: $label" >&2
    fi
    sleep 1
  }

  run_step "openclaw version" /app/node_modules/.bin/openclaw --version
  run_step "gbrain version" /data/.bun/bin/gbrain --version
  run_step "node version" node -p process.version
  run_step "bun version" /data/.bun/bin/bun --version

  run_step "openclaw config file" /app/node_modules/.bin/openclaw config file
  run_step "openclaw config shape" "node -e 'const fs=require(\"fs\");const cfg=JSON.parse(fs.readFileSync(\"/data/.openclaw/openclaw.json\",\"utf8\"));function keys(obj){return obj&&typeof obj===\"object\"?Object.keys(obj).sort().join(\",\"):\"\"};console.log(\"top_level_keys=\"+keys(cfg));console.log(\"gateway_keys=\"+keys(cfg.gateway));console.log(\"plugins_entry_keys=\"+keys(cfg.plugins&&cfg.plugins.entries));console.log(\"mcp_server_count=\"+Object.keys((cfg.mcp&&cfg.mcp.servers)||{}).length);'"
  run_optional_step "openclaw legacy gateway auth mode" /app/node_modules/.bin/openclaw config get gateway.auth.mode
  run_optional_step "openclaw legacy gateway bind" /app/node_modules/.bin/openclaw config get gateway.bind
  run_step "openclaw config validate" /app/node_modules/.bin/openclaw config validate
  run_step "openclaw mcp list" /app/node_modules/.bin/openclaw mcp list
  run_optional_step "openclaw gbrain plugin config" /app/node_modules/.bin/openclaw config get plugins.entries.gbrain
  run_step_filtered "openclaw plugin gbrain scan" "gbrain|Plugins \\(|failed|device-pair" \
    /app/node_modules/.bin/openclaw plugins list
  run_step "openclaw skill query" /app/node_modules/.bin/openclaw skills info query

  run_step "gbrain fast doctor" /data/.bun/bin/gbrain doctor --fast --json
  run_step "gbrain supervisor" /data/.bun/bin/gbrain jobs supervisor status --json
  run_step "gbrain job stats" /data/.bun/bin/gbrain jobs stats
  run_step "gbrain dead jobs summary" /data/.bun/bin/gbrain jobs list --status dead --limit 5

  run_step "cron names /etc/cron.d" ls -1 /etc/cron.d
  run_step "cron names /data/.openclaw/cron/system" ls -1 /data/.openclaw/cron/system
  run_step "direct-minions processes" "pgrep -af '^node /data/.openclaw/cron/bin/direct-minions-scheduler.mjs' || true"
  run_step "direct-minions scheduler validate" "node /data/.openclaw/cron/bin/direct-minions-scheduler.mjs --validate"
  run_step "direct-minions enabled agent wrappers" "node -e 'const fs=require(\"fs\"); const root=JSON.parse(fs.readFileSync(\"/data/.openclaw/cron/direct-minions/jobs.json\",\"utf8\")); const jobs=Array.isArray(root)?root:root.jobs||[]; const active=jobs.filter(j=>j.enabled!==false && String(j.command||\"\").includes(\"gbrain-submit-openclaw-agent-job.sh\")); console.log(JSON.stringify({enabled_agent_wrapper_count:active.length, enabled_agent_wrappers:active.map(j=>j.name)},null,2));'"
}

run_dead_jobs_readonly() {
  require_command railway

  if [[ "$TARGET_SERVICE_ID" == "$FORBIDDEN_SERVICE_ID" ]]; then
    echo "REFUSING forbidden service id: $FORBIDDEN_SERVICE_ID" >&2
    exit 2
  fi

  echo "== dead jobs readonly target =="
  echo "project=$TARGET_PROJECT_ID"
  echo "environment=$TARGET_ENVIRONMENT ($TARGET_ENVIRONMENT_ID)"
  echo "service=$TARGET_SERVICE_NAME ($TARGET_SERVICE_ID)"

  railway ssh \
    --project "$TARGET_PROJECT_ID" \
    --environment "$TARGET_ENVIRONMENT" \
    --service "$TARGET_SERVICE_ID" \
    '
set -eu
ids="$(/data/.bun/bin/gbrain jobs list --status dead --limit 5 | sed -nE "s/^ *([0-9]+) .*/\1/p" | head -5)"
if [ -z "$ids" ]; then
  echo "no_dead_jobs"
  exit 0
fi
for id in $ids; do
  echo "== job $id metadata =="
  /data/.bun/bin/gbrain jobs get "$id" 2>/dev/null \
    | sed -E "s/sk-[A-Za-z0-9_-]{20,}/sk-REDACTED/g; s/Bearer [A-Za-z0-9._-]+/Bearer REDACTED/g; s#postgres(ql)?://[^ ]+#POSTGRES_URL_REDACTED#g" \
    | grep -Ei "^(Job #|  ID:|  Name:|  Type:|  Status:|  Queue:|  Created:|  Started:|  Finished:|  Duration:|  Attempts:|  Error:)|Config warnings|plugins\\.entries\\.device-pair|FallbackSummaryError|FailoverError|rate_limit|usage limit" \
    | head -40 || true
done
'
}

run_gbrain_install_readonly() {
  require_command railway

  if [[ "$TARGET_SERVICE_ID" == "$FORBIDDEN_SERVICE_ID" ]]; then
    echo "REFUSING forbidden service id: $FORBIDDEN_SERVICE_ID" >&2
    exit 2
  fi

  echo "== gbrain install readonly target =="
  echo "project=$TARGET_PROJECT_ID"
  echo "environment=$TARGET_ENVIRONMENT ($TARGET_ENVIRONMENT_ID)"
  echo "service=$TARGET_SERVICE_NAME ($TARGET_SERVICE_ID)"

  railway ssh \
    --project "$TARGET_PROJECT_ID" \
    --environment "$TARGET_ENVIRONMENT" \
    --service "$TARGET_SERVICE_ID" \
    '
set -eu
echo "== gbrain wrapper =="
printf "wrapper_path=/data/.bun/bin/gbrain\n"
ls -l /data/.bun/bin/gbrain
sed -n "1,12p" /data/.bun/bin/gbrain \
  | grep -E "^(#!/usr/bin/env bash|set -e|export HOME=/data|export GBRAIN_HOME=/data|export BRAIN_REPO=/data/brain|cd /data/gbrain|exec /data/.bun/bin/bun run src/cli.ts)" || true

echo "== gbrain checkout =="
cd /data/gbrain
printf "branch="
git branch --show-current || true
printf "head="
git rev-parse HEAD
printf "status_short_count="
git status --short | wc -l | tr -d " "
printf "\n"
git status --short | head -20
printf "remote_fetch="
remote_fetch="$(git remote get-url origin 2>/dev/null || true)"
case "$remote_fetch" in
  ""|"https://github.com/garrytan/gbrain.git"|"git@github.com:garrytan/gbrain.git")
    printf "%s\n" "$remote_fetch"
    ;;
  *)
    printf "REDACTED\n"
    ;;
esac
printf "package_version="
node -e "console.log(require(\"./package.json\").version)" 2>/dev/null || true
printf "bun_version="
/data/.bun/bin/bun --version
printf "gbrain_version="
/data/.bun/bin/gbrain --version
'
}

main() {
  case "${1:-}" in
    --help|-h)
      usage
      ;;
    --local)
      run_local
      ;;
    --railway)
      run_railway
      ;;
    --railway-current)
      run_railway_current
      ;;
    --runtime-readonly)
      run_runtime_readonly
      ;;
    --dead-jobs-readonly)
      run_dead_jobs_readonly
      ;;
    --gbrain-install-readonly)
      run_gbrain_install_readonly
      ;;
    "")
      usage
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 64
      ;;
  esac
}

main "$@"
