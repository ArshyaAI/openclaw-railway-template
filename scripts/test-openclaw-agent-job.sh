#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d /tmp/openclaw-agent-job-test.XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT

mkdir -p "$tmpdir/data/.openclaw/workspace" "$tmpdir/app/node_modules/.bin"
: > "$tmpdir/data/.openclaw/.env"
printf 'test prompt\n' > "$tmpdir/prompt.md"

cat > "$tmpdir/app/node_modules/.bin/openclaw" <<'FAKE_OPENCLAW'
#!/usr/bin/env bash
set -euo pipefail

model=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --model)
      model="$2"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done

printf '%s\n' "$model" >> "$OPENCLAW_AGENT_JOB_TEST_LOG"

case "${OPENCLAW_AGENT_JOB_TEST_MODE:-}" in
  primary_fail_no_fallback)
    printf 'non quota failure\n' >&2
    exit 42
    ;;
  fallback_success)
    if [ "$model" = "openai-codex/gpt-5.5" ]; then
      printf 'Provider openai-codex is in cooldown (all profiles unavailable)\n' >&2
      exit 42
    fi
    exit 0
    ;;
  fallback_fail)
    if [ "$model" = "openai-codex/gpt-5.5" ]; then
      printf 'Provider openai-codex is in cooldown (all profiles unavailable)\n' >&2
      exit 42
    fi
    printf 'fallback failed\n' >&2
    exit 77
    ;;
  *)
    printf 'unknown OPENCLAW_AGENT_JOB_TEST_MODE\n' >&2
    exit 99
    ;;
esac
FAKE_OPENCLAW
chmod +x "$tmpdir/app/node_modules/.bin/openclaw"

run_wrapper() {
  OPENCLAW_AGENT_JOB_DATA_HOME="$tmpdir/data" \
  OPENCLAW_AGENT_JOB_APP_ROOT="$tmpdir/app" \
  OPENCLAW_AGENT_JOB_TEST_LOG="$tmpdir/models.log" \
  OPENCLAW_AGENT_JOB_MODEL="${OPENCLAW_AGENT_JOB_MODEL:-openai-codex/gpt-5.5}" \
  OPENCLAW_AGENT_JOB_FALLBACK_MODEL="${OPENCLAW_AGENT_JOB_FALLBACK_MODEL:-}" \
  OPENCLAW_AGENT_JOB_TEST_MODE="$1" \
    bash "$repo_root/patches/openclaw-agent-job.sh" test-job "$tmpdir/prompt.md" test-slot
}

assert_status() {
  local expected="$1"
  shift
  set +e
  "$@" >"$tmpdir/out.log" 2>"$tmpdir/err.log"
  local actual=$?
  set -e
  if [ "$actual" -ne "$expected" ]; then
    printf 'expected status %s, got %s\n' "$expected" "$actual" >&2
    printf 'stderr:\n' >&2
    cat "$tmpdir/err.log" >&2
    exit 1
  fi
}

: > "$tmpdir/models.log"
unset OPENCLAW_AGENT_JOB_FALLBACK_MODEL
assert_status 42 run_wrapper primary_fail_no_fallback
grep -qx 'openai-codex/gpt-5.5' "$tmpdir/models.log"

: > "$tmpdir/models.log"
OPENCLAW_AGENT_JOB_FALLBACK_MODEL="openai/gpt-5.4" assert_status 0 run_wrapper fallback_success
printf 'openai-codex/gpt-5.5\nopenai/gpt-5.4\n' > "$tmpdir/expected-models.log"
cmp "$tmpdir/expected-models.log" "$tmpdir/models.log"

: > "$tmpdir/models.log"
OPENCLAW_AGENT_JOB_FALLBACK_MODEL="openai/gpt-5.4" assert_status 77 run_wrapper fallback_fail
cmp "$tmpdir/expected-models.log" "$tmpdir/models.log"

printf 'openclaw-agent-job tests passed\n'
