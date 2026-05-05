#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 1 ]; then
  echo "usage: $0 <script-path> [args...]" >&2
  exit 2
fi

script_path="$1"
shift || true

if [ ! -f "$script_path" ]; then
  echo "script file not found: $script_path" >&2
  exit 1
fi

stdout_file="$(mktemp /tmp/astack-shell-job.XXXXXX.out)"
stderr_file="$(mktemp /tmp/astack-shell-job.XXXXXX.err)"
trap 'rm -f "$stdout_file" "$stderr_file"' EXIT

set +e
bash "$script_path" "$@" >"$stdout_file" 2>"$stderr_file"
status=$?
set -e

sanitize_log() {
  sed -E \
    -e 's/sk-[A-Za-z0-9_-]{20,}/sk-REDACTED/g' \
    -e 's/Bearer [A-Za-z0-9._-]+/Bearer REDACTED/g' \
    -e 's#postgres(ql)?://[^ ]+#POSTGRES_URL_REDACTED#g' \
    -e 's/(TOKEN|KEY|SECRET|PASSWORD|COOKIE|DATABASE_URL)[A-Za-z0-9_]*=[^ ]+/\1=REDACTED/g'
}

if [ "$status" -eq 0 ]; then
  cat "$stdout_file"
  cat "$stderr_file" >&2
  exit 0
fi

if grep -Eiq 'CreditsDepleted|api\.(twitter|x)\.com/2/problems/credits' "$stdout_file" "$stderr_file"; then
  {
    printf '{"ts":"%s","event":"skipped_external_quota","class":"x_api_credits_depleted","script":"%s","original_exit":%s}\n' \
      "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$script_path" "$status"
    printf 'captured_tail:\n'
    { cat "$stdout_file"; cat "$stderr_file"; } | tail -40 | sanitize_log
  } >&2
  exit 0
fi

cat "$stdout_file"
cat "$stderr_file" >&2
exit "$status"
