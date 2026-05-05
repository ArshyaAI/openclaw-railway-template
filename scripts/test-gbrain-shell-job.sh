#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
tmpdir="$(mktemp -d /tmp/gbrain-shell-job-test.XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT

mkdir -p "$tmpdir/data/.openclaw/cron/bin" "$tmpdir/data/.openclaw/workspace" "$tmpdir/data/.bun/bin"
: > "$tmpdir/data/.openclaw/.env"
cp "$repo_root/patches/astack-shell-job-runner.sh" "$tmpdir/data/.openclaw/cron/bin/astack-shell-job-runner.sh"
chmod +x "$tmpdir/data/.openclaw/cron/bin/astack-shell-job-runner.sh"

cat > "$tmpdir/data/.bun/bin/gbrain" <<'FAKE_GBRAIN'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$GBRAIN_SHELL_JOB_TEST_ARGS"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --params)
      printf '%s\n' "$2" > "$GBRAIN_SHELL_JOB_TEST_PARAMS"
      shift 2
      ;;
    *)
      shift
      ;;
  esac
done
FAKE_GBRAIN
chmod +x "$tmpdir/data/.bun/bin/gbrain"

cat > "$tmpdir/ok.sh" <<'SCRIPT'
#!/usr/bin/env bash
echo ok
SCRIPT

cat > "$tmpdir/quota.sh" <<'SCRIPT'
#!/usr/bin/env bash
echo BOOKMARKS_START
echo '{"title":"CreditsDepleted","type":"https://api.twitter.com/2/problems/credits"}' >&2
exit 1
SCRIPT

cat > "$tmpdir/fail.sh" <<'SCRIPT'
#!/usr/bin/env bash
echo hard fail >&2
exit 42
SCRIPT

chmod +x "$tmpdir/"*.sh

assert_status() {
  local expected="$1"
  shift
  set +e
  "$@" >"$tmpdir/out.log" 2>"$tmpdir/err.log"
  local actual=$?
  set -e
  if [ "$actual" -ne "$expected" ]; then
    printf 'expected status %s, got %s\n' "$expected" "$actual" >&2
    printf 'stdout:\n' >&2
    cat "$tmpdir/out.log" >&2
    printf 'stderr:\n' >&2
    cat "$tmpdir/err.log" >&2
    exit 1
  fi
}

GBRAIN_SHELL_JOB_TEST_ARGS="$tmpdir/gbrain-args.log" \
GBRAIN_SHELL_JOB_TEST_PARAMS="$tmpdir/params.json" \
GBRAIN_SHELL_JOB_DATA_HOME="$tmpdir/data" \
GBRAIN_SHELL_JOB_GBRAIN_BIN="$tmpdir/data/.bun/bin/gbrain" \
  bash "$repo_root/patches/gbrain-submit-shell-job.sh" test-job "$tmpdir/ok.sh" %Y-%m-%dT%H 1000

node - "$tmpdir/params.json" "$tmpdir/data/.openclaw/cron/bin/astack-shell-job-runner.sh" "$tmpdir/ok.sh" <<'NODE'
const fs = require('node:fs');
const [paramsPath, runner, script] = process.argv.slice(2);
const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
if (params.cwd.endsWith('/data/.openclaw/workspace') !== true) throw new Error(`bad cwd: ${params.cwd}`);
if (params.argv[0] !== 'bash' || params.argv[1] !== runner || params.argv[2] !== script) {
  throw new Error(`bad argv: ${JSON.stringify(params.argv)}`);
}
NODE

assert_status 0 bash "$repo_root/patches/astack-shell-job-runner.sh" "$tmpdir/ok.sh"
grep -qx ok "$tmpdir/out.log"

assert_status 0 bash "$repo_root/patches/astack-shell-job-runner.sh" "$tmpdir/quota.sh"
grep -q 'skipped_external_quota' "$tmpdir/err.log"
grep -q 'x_api_credits_depleted' "$tmpdir/err.log"

assert_status 42 bash "$repo_root/patches/astack-shell-job-runner.sh" "$tmpdir/fail.sh"
grep -q 'hard fail' "$tmpdir/err.log"

rm -f "$tmpdir/data/.openclaw/cron/bin/astack-shell-job-runner.sh"
GBRAIN_SHELL_JOB_TEST_ARGS="$tmpdir/gbrain-args-no-runner.log" \
GBRAIN_SHELL_JOB_TEST_PARAMS="$tmpdir/params-no-runner.json" \
GBRAIN_SHELL_JOB_DATA_HOME="$tmpdir/data" \
GBRAIN_SHELL_JOB_GBRAIN_BIN="$tmpdir/data/.bun/bin/gbrain" \
  bash "$repo_root/patches/gbrain-submit-shell-job.sh" test-job "$tmpdir/ok.sh" %Y-%m-%dT%H 1000

node - "$tmpdir/params-no-runner.json" "$tmpdir/ok.sh" <<'NODE'
const fs = require('node:fs');
const [paramsPath, script] = process.argv.slice(2);
const params = JSON.parse(fs.readFileSync(paramsPath, 'utf8'));
if (params.argv[0] !== 'bash' || params.argv[1] !== script || params.argv.length !== 2) {
  throw new Error(`bad fallback argv: ${JSON.stringify(params.argv)}`);
}
NODE

printf 'gbrain shell job tests passed\n'
