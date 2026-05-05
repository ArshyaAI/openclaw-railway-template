#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 2 ]; then
  echo "usage: $0 <job-name> <script-path> [slot-format] [timeout-ms]" >&2
  exit 2
fi

job_name="$1"
script_path="$2"
slot_format="${3:-%Y-%m-%dT%H:%M}"
timeout_ms="${4:-1800000}"
slot="$(date -u +"$slot_format")"

data_home="${GBRAIN_SHELL_JOB_DATA_HOME:-/data}"
workspace="${GBRAIN_SHELL_JOB_WORKSPACE:-$data_home/.openclaw/workspace}"
runner="${GBRAIN_SHELL_JOB_RUNNER:-$data_home/.openclaw/cron/bin/astack-shell-job-runner.sh}"
gbrain_bin="${GBRAIN_SHELL_JOB_GBRAIN_BIN:-$data_home/.bun/bin/gbrain}"

export HOME="$data_home"
export GBRAIN_HOME="${GBRAIN_HOME:-$data_home/gbrain}"
export BRAIN_REPO="${BRAIN_REPO:-$data_home/brain}"
export BUN_INSTALL="${BUN_INSTALL:-$data_home/.bun}"
export PATH="$data_home/.bun/bin:$PATH"

if [ -f "$data_home/.openclaw/.env" ]; then
  set -a
  . "$data_home/.openclaw/.env"
  set +a
fi

if [ -x "$runner" ]; then
  params="$(node - "$workspace" "$runner" "$script_path" <<'NODE'
const [, , cwd, runner, scriptPath] = process.argv;
console.log(JSON.stringify({
  argv: ["bash", runner, scriptPath],
  cwd,
}));
NODE
)"
else
  params="$(node - "$workspace" "$script_path" <<'NODE'
const [, , cwd, scriptPath] = process.argv;
console.log(JSON.stringify({
  argv: ["bash", scriptPath],
  cwd,
}));
NODE
)"
fi

exec "$gbrain_bin" jobs submit shell --params "$params" --timeout-ms "$timeout_ms" --idempotency-key "${job_name}:${slot}"
