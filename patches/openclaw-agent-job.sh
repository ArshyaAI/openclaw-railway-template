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

data_home="${OPENCLAW_AGENT_JOB_DATA_HOME:-/data}"
app_root="${OPENCLAW_AGENT_JOB_APP_ROOT:-/app}"
workspace="${OPENCLAW_AGENT_JOB_WORKSPACE:-$data_home/.openclaw/workspace}"
openclaw_bin="${OPENCLAW_AGENT_JOB_OPENCLAW_BIN:-$app_root/node_modules/.bin/openclaw}"

export HOME="$data_home"
export GBRAIN_HOME="${GBRAIN_HOME:-$data_home/gbrain}"
export BRAIN_REPO="${BRAIN_REPO:-$data_home/brain}"
export BUN_INSTALL="${BUN_INSTALL:-$data_home/.bun}"
export PATH="$app_root/node_modules/.bin:$data_home/.bun/bin:$PATH"

if [ -f "$data_home/.openclaw/.env" ]; then
  set -a
  . "$data_home/.openclaw/.env"
  set +a
fi

export OPENCLAW_GATEWAY_TOKEN="${OPENCLAW_GATEWAY_TOKEN:-local-cron-placeholder}"

cd "$workspace"
message="$(cat "$prompt_path")"
safe_job_name="$(printf '%s' "$job_name" | tr -cs 'A-Za-z0-9._-' '-')"
safe_slot="$(printf '%s' "$slot" | tr -cs 'A-Za-z0-9._-' '-')"
session_id="${safe_job_name}-${safe_slot}-$$"

primary_model="${OPENCLAW_AGENT_JOB_MODEL:-openai-codex/gpt-5.4}"
fallback_model="${OPENCLAW_AGENT_JOB_FALLBACK_MODEL:-}"

run_agent() {
  local model="$1"
  "$openclaw_bin" agent \
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
fallback_err_file="$(mktemp /tmp/openclaw-agent-job.XXXXXX.fallback.err)"
trap 'rm -f "$err_file" "$fallback_err_file"' EXIT

if run_agent "$primary_model" 2>"$err_file"; then
  exit 0
else
  status=$?
fi

if [ -n "$fallback_model" ] && grep -Eiq 'cooldown|rate_limit|usage limit|all profiles unavailable|FailoverError' "$err_file"; then
  echo "[openclaw-agent-job] primary model failed with quota/cooldown; retrying fallback model" >&2
  if run_agent "$fallback_model" 2>"$fallback_err_file"; then
    exit 0
  else
    fallback_status=$?
  fi
  cat "$err_file" >&2
  cat "$fallback_err_file" >&2
  exit "$fallback_status"
fi

cat "$err_file" >&2
exit "$status"
