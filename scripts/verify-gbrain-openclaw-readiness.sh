#!/usr/bin/env bash
set -euo pipefail

TARGET_PROJECT_ID="fbdb217b-060f-4f1e-8697-08a6288a19c4"
TARGET_ENVIRONMENT="production"
TARGET_ENVIRONMENT_ID="614198f2-f7ed-4756-ae83-e0dd23943c9d"
TARGET_SERVICE_ID="6f333a2b-07d9-4219-8531-3b96fbc6a2f9"
TARGET_SERVICE_NAME="openclaw-railway-template"
FORBIDDEN_SERVICE_ID="63b84308-25d7-4b03-9c23-4d0d7239728f"
UPSTREAM_GBRAIN_SHA="3c032d79ecccff8d87a5b601a34b9e7cb8194dd7"

usage() {
  cat <<'EOF'
Usage:
  npm run verify:gbrain -- --help
  npm run verify:gbrain -- --local
  npm run verify:gbrain -- --railway
  npm run verify:gbrain -- --runtime-readonly

Modes:
  --local     Read local repo pins and safe local CLI health summaries.
  --railway   Read target Railway service status, deployment history, and
              filtered logs using a temporary CLI link.
  --runtime-readonly
              SSH into the target service and run redacted read-only runtime
              diagnostics. Does not print env vars or secret values.

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

  if command -v gbrain >/dev/null 2>&1; then
    echo "== local gbrain =="
    gbrain --version || true
    gbrain doctor --fast --json || true
  else
    echo "WARN local gbrain not found on PATH"
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

  tmpbase="${GBRAIN_VERIFY_TMPDIR:-}"
  if [[ -z "$tmpbase" ]]; then
    if [[ "$(uname -s)" == "Darwin" ]]; then
      tmpbase="/private/tmp"
    else
      tmpbase="${TMPDIR:-/tmp}"
    fi
  fi
  mkdir -p "$tmpbase"
  tmpdir="$(mktemp -d "$tmpbase/gbrain-railway-readonly.XXXXXX")"
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
    railway ssh \
      --project "$TARGET_PROJECT_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --service "$TARGET_SERVICE_ID" \
      "$@"
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

  run_step "openclaw version" /app/node_modules/.bin/openclaw --version
  run_step "gbrain version" /data/.bun/bin/gbrain --version
  run_step "node version" node -p process.version
  run_step "bun version" /data/.bun/bin/bun --version

  run_step "openclaw config validate" /app/node_modules/.bin/openclaw config validate
  run_step "openclaw mcp list" /app/node_modules/.bin/openclaw mcp list
  run_step_filtered "openclaw plugin gbrain scan" "gbrain|Plugins \\(|failed|device-pair" \
    /app/node_modules/.bin/openclaw plugins list
  run_step "openclaw skill query" /app/node_modules/.bin/openclaw skills info query

  run_step "gbrain fast doctor" /data/.bun/bin/gbrain doctor --fast --json
  run_step "gbrain supervisor" /data/.bun/bin/gbrain jobs supervisor status --json
  run_step "gbrain job stats" /data/.bun/bin/gbrain jobs stats

  run_step "cron names /etc/cron.d" ls -1 /etc/cron.d
  run_step "cron names /data/.openclaw/cron/system" ls -1 /data/.openclaw/cron/system
  run_step "direct-minions process count" pgrep -cf direct-minions
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
    --runtime-readonly)
      run_runtime_readonly
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
