#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 3 ]; then
  echo "usage: $0 <job-name> <prompt-path> <slot>" >&2
  exit 2
fi

job_name="$1"
prompt_path="$2"
slot="$3"

if [ ! -f "$prompt_path" ]; then
  echo "prompt file not found: $prompt_path" >&2
  exit 1
fi

export HOME=/data
export GBRAIN_HOME=/data/gbrain
export BRAIN_REPO=/data/brain
export BUN_INSTALL=/data/.bun
export PATH="/app/node_modules/.bin:/data/.bun/bin:$PATH"

set -a
. /data/.openclaw/.env
set +a

export OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-local-cron-placeholder}"

cd /data/.openclaw/workspace
message="$(cat "$prompt_path")"
safe_job_name="$(printf '%s' "$job_name" | tr -cs 'A-Za-z0-9._-' '-')"
safe_slot="$(printf '%s' "$slot" | tr -cs 'A-Za-z0-9._-' '-')"
session_id="${safe_job_name}-${safe_slot}-$$"

primary_model="${OPENCLAW_AGENT_JOB_MODEL:-openai/gpt-5.4}"
fallback_model="${OPENCLAW_AGENT_JOB_FALLBACK_MODEL:-}"

run_agent() {
  local model="$1"
  /app/node_modules/.bin/openclaw agent \
    --local \
    --agent main \
    --session-id "$session_id" \
    --model "$model" \
    --message "$message" \
    --deliver \
    --reply-channel telegram \
    --reply-account default \
    --reply-to 422412426 \
    --timeout 1800
}

err_file="$(mktemp /tmp/openclaw-agent-job.XXXXXX.err)"
trap 'rm -f "$err_file"' EXIT

if run_agent "$primary_model" 2>"$err_file"; then
  exit 0
fi
status=$?

if [ -n "$fallback_model" ] && grep -Eiq 'cooldown|rate_limit|usage limit|all profiles unavailable|FailoverError' "$err_file"; then
  echo "[openclaw-agent-job] primary model failed with quota/cooldown; retrying fallback model" >&2
  if run_agent "$fallback_model"; then
    exit 0
  fi
fi

cat "$err_file" >&2
exit "$status"
