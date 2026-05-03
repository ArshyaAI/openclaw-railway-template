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

Modes:
  --local     Read local repo pins and safe local CLI health summaries.
  --railway   Read target Railway service status, deployment history, and
              filtered logs using a temporary CLI link.

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

  if [[ "$TARGET_SERVICE_ID" == "$FORBIDDEN_SERVICE_ID" ]]; then
    echo "REFUSING forbidden service id: $FORBIDDEN_SERVICE_ID" >&2
    exit 2
  fi

  tmpbase="${GBRAIN_VERIFY_TMPDIR:-/tmp}"
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
    railway service status \
      --service "$TARGET_SERVICE_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --json

    echo "== latest deployments =="
    railway deployment list \
      --service "$TARGET_SERVICE_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --json \
      | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const xs=JSON.parse(s); for (const d of xs.slice(0,5)) console.log(`${d.id}\t${d.status}\t${d.createdAt}\t${d.meta?.cliMessage || d.meta?.commitMessage || ""}`);})'

    echo "== filtered risk logs =="
    risk_log="$tmpdir/risk-logs.txt"
    railway logs \
      --service "$TARGET_SERVICE_ID" \
      --environment "$TARGET_ENVIRONMENT" \
      --lines 500 \
      | rg -i "token_mismatch|sessions/store|prolite|rate limit|gbrain|direct-minions|supervisor|cron|error|warn" \
      > "$risk_log" || true

    total_matches="$(wc -l < "$risk_log" | tr -d ' ')"
    token_mismatch_matches="$(rg -c "token_mismatch" "$risk_log" || true)"
    session_store_matches="$(rg -c "sessions/store" "$risk_log" || true)"
    rate_limit_matches="$(rg -ci "prolite|rate limit" "$risk_log" || true)"

    echo "matching_lines=$total_matches"
    echo "token_mismatch_lines=$token_mismatch_matches"
    echo "sessions_store_lines=$session_store_matches"
    echo "rate_limit_lines=$rate_limit_matches"
    echo "last_matching_lines="
    tail -40 "$risk_log" \
      | sed -E 's/(conn|instance|runId|profile)=([^ ]+)/\1=REDACTED/g'
  )
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
