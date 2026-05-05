#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const PROJECT_ID = 'fbdb217b-060f-4f1e-8697-08a6288a19c4';
const ENVIRONMENT = 'production';
const TARGET_SERVICE_ID = '6f333a2b-07d9-4219-8531-3b96fbc6a2f9';
const TARGET_SERVICE_NAME = 'openclaw-railway-template';
const FORBIDDEN_SERVICE_ID = '63b84308-25d7-4b03-9c23-4d0d7239728f';
const APPROVAL_PHRASE = 'openclaw-gbrain-runtime-upgrade';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const json = args.has('--json');
const targetSha = process.env.GBRAIN_RUNTIME_UPGRADE_SHA || readUpstreamSha();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');

if (TARGET_SERVICE_ID === FORBIDDEN_SERVICE_ID) {
  fail('BLOCKED_FORBIDDEN_SERVICE_RISK', 'refusing forbidden Railway service id');
}

if (!targetSha || !/^[0-9a-f]{40}$/.test(targetSha)) {
  fail('BLOCKED_UPSTREAM_UNKNOWN', `invalid target SHA: ${targetSha || 'unknown'}`);
}

const current = readRuntime();
const backupDir = `/data/backups/gbrain-runtime-upgrade/${stamp}`;
const base = {
  target: {
    project_id: PROJECT_ID,
    environment: ENVIRONMENT,
    service_name: TARGET_SERVICE_NAME,
    service_id: TARGET_SERVICE_ID,
  },
  mode: execute ? 'execute' : 'plan',
  approval_required: APPROVAL_PHRASE,
  approved: process.env.GBRAIN_RUNTIME_UPGRADE_APPROVED === APPROVAL_PHRASE,
  current,
  target_sha: targetSha,
  backup_dir: backupDir,
  expected_impact: [
    'mutates only /data/gbrain and migration state on the approved OpenClaw target service',
    'does not restart, redeploy, or touch the forbidden NIKIN production service',
    'runs GBrain schema/orchestrator migrations against the configured shared brain',
    'target GBrain 0.26.8 includes migration v35, which installs a Postgres event trigger and backfills RLS on non-exempt public tables',
    'must be followed by full doctor plus direct/OpenClaw/remote/local canaries',
  ],
  pre_execute_readonly_checks: [
    'confirm target service id is openclaw-railway-template / 6f333a2b-07d9-4219-8531-3b96fbc6a2f9',
    'audit public tables where relrowsecurity=false and no GBRAIN:RLS_EXEMPT comment exists',
    'if that audit returns any rows, stop and add explicit GBRAIN:RLS_EXEMPT comments or accept the RLS backfill before executing',
    'decide whether upstream PR #619/#620/#626 must be merged/consumed first; upgrading to pure upstream 0.26.8 drops the live #626 cherry-pick',
  ],
  rollback: [
    `cd /data/gbrain && git checkout ${current.sha || '<old_sha>'}`,
    'bun install --frozen-lockfile',
    '/data/.bun/bin/gbrain init --migrate-only --json',
    '/data/.bun/bin/gbrain apply-migrations --yes --non-interactive',
    '/data/.bun/bin/gbrain doctor --json',
    `backup artifacts live under ${backupDir} when --execute is used`,
  ],
  post_execute_canaries: [
    'npm run verify:gbrain -- --runtime-readonly',
    'npm run canary:gbrain',
    'npm run canary:gbrain-remote-fixture',
    'npm run canary:gbrain-claude',
    'npm run verify:gbrain-full-pass-gates -- --json',
  ],
};

if (!execute) {
  print({ status: 'PLAN', ...base });
  process.exit(0);
}

if (process.env.GBRAIN_RUNTIME_UPGRADE_APPROVED !== APPROVAL_PHRASE) {
  print({
    status: 'BLOCKED_APPROVAL_REQUIRED',
    ...base,
    run_with: `GBRAIN_RUNTIME_UPGRADE_APPROVED=${APPROVAL_PHRASE} npm run upgrade:gbrain-runtime -- --execute --json`,
  });
  process.exit(2);
}

const execution = executeRemoteUpgrade(targetSha, backupDir);
print({
  status: 'EXECUTED',
  ...base,
  execution,
});

function readUpstreamSha() {
  const out = run('git', ['ls-remote', 'https://github.com/garrytan/gbrain.git', 'refs/heads/master']);
  return out?.split(/\s+/)[0] || null;
}

function readRuntime() {
  const command = [
    runtimeEnv(),
    'sh -lc',
    quote([
      'cd /data/gbrain',
      `printf 'service_name=%s\\n' ${quote(TARGET_SERVICE_NAME)}`,
      `printf 'service_id=%s\\n' ${quote(TARGET_SERVICE_ID)}`,
      'printf "sha=%s\\n" "$(git rev-parse HEAD)"',
      'printf "branch=%s\\n" "$(git branch --show-current || true)"',
      'printf "version=%s\\n" "$(/data/.bun/bin/gbrain --version)"',
    ].join(' && ')),
  ].join(' ');
  const text = railwaySsh(command);
  const values = Object.fromEntries(text.split(/\r?\n/).map((line) => {
    const idx = line.indexOf('=');
    return idx === -1 ? null : [line.slice(0, idx), line.slice(idx + 1)];
  }).filter(Boolean));
  return {
    service_name: values.service_name || TARGET_SERVICE_NAME,
    service_id: values.service_id || TARGET_SERVICE_ID,
    sha: values.sha || null,
    branch: values.branch || null,
    version: values.version || null,
  };
}

function executeRemoteUpgrade(sha, backupPath) {
  const script = [
    'set -euo pipefail',
    'export HOME=/data',
    'export GBRAIN_HOME=/data',
    'export BRAIN_REPO=/data/brain',
    'export BUN_INSTALL=/data/.bun',
    'export PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    `target_sha=${quote(sha)}`,
    `backup_dir=${quote(backupPath)}`,
    'mkdir -p "$backup_dir"',
    'cd /data/gbrain',
    'old_sha="$(git rev-parse HEAD)"',
    'old_version="$(/data/.bun/bin/gbrain --version || true)"',
    'printf "%s\\n" "$old_sha" > "$backup_dir/old_sha.txt"',
    'printf "%s\\n" "$old_version" > "$backup_dir/old_version.txt"',
    'tar -C /data -czf "$backup_dir/gbrain.tgz" gbrain',
    '[ -d /data/.gbrain ] && tar -C /data -czf "$backup_dir/dot-gbrain.tgz" .gbrain || true',
    '[ -f /data/.openclaw/openclaw.json ] && cp /data/.openclaw/openclaw.json "$backup_dir/openclaw.json" || true',
    'supervisor_was_running=0',
    'if /data/.bun/bin/gbrain jobs supervisor status --json > "$backup_dir/supervisor-before.json" 2>&1 && grep -q \'"running"[[:space:]]*:[[:space:]]*true\' "$backup_dir/supervisor-before.json"; then',
    '  supervisor_was_running=1',
    '  /data/.bun/bin/gbrain jobs supervisor stop --json 2>&1 | tee "$backup_dir/supervisor-stop.json"',
    'fi',
    'git fetch origin',
    'git checkout "$target_sha"',
    'bun install --frozen-lockfile',
    '/data/.bun/bin/gbrain --version | tee "$backup_dir/new_version.txt"',
    '/data/.bun/bin/gbrain init --migrate-only --json 2>&1 | tee "$backup_dir/init-migrate-only.log"',
    '/data/.bun/bin/gbrain apply-migrations --yes --non-interactive 2>&1 | tee "$backup_dir/apply-migrations.log"',
    '/data/.bun/bin/gbrain doctor --json | tee "$backup_dir/doctor.json"',
    'if [ "$supervisor_was_running" = "1" ]; then',
    '  /data/.bun/bin/gbrain jobs supervisor start --detach --json --allow-shell-jobs --cli-path /data/.bun/bin/gbrain 2>&1 | tee "$backup_dir/supervisor-start.json"',
    '  sleep 2',
    'fi',
    '/data/.bun/bin/gbrain jobs supervisor status --json 2>&1 | tee "$backup_dir/supervisor-status.json"',
    'printf "old_sha=%s\\nold_version=%s\\nnew_sha=%s\\nbackup_dir=%s\\nsupervisor_was_running=%s\\n" "$old_sha" "$old_version" "$(git rev-parse HEAD)" "$backup_dir" "$supervisor_was_running"',
  ].join('\n');
  const text = railwaySsh(['bash -lc', quote(script)].join(' '), { timeout: 900_000 });
  return {
    output: redact(text),
  };
}

function railwaySsh(command, opts = {}) {
  return run('railway', [
    'ssh',
    '--project', PROJECT_ID,
    '--environment', ENVIRONMENT,
    '--service', TARGET_SERVICE_ID,
    command,
  ], opts);
}

function runtimeEnv() {
  return 'env HOME=/data GBRAIN_HOME=/data BRAIN_REPO=/data/brain BUN_INSTALL=/data/.bun PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
}

function run(cmd, cmdArgs, opts = {}) {
  try {
    return execFileSync(cmd, cmdArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: opts.timeout || 180_000,
    }).trim();
  } catch (err) {
    const detail = [
      err.stdout?.toString?.() || '',
      err.stderr?.toString?.() || '',
      err.message || String(err),
    ].join('\n').trim();
    throw new Error(redact(`${cmd} ${cmdArgs.join(' ')} failed: ${detail}`));
  }
}

function print(payload) {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`status=${payload.status}`);
    if (payload.message) console.log(`message=${payload.message}`);
    if (!payload.target || !payload.current) return;
    console.log(`mode=${payload.mode}`);
    console.log(`target_service=${payload.target.service_name} (${payload.target.service_id})`);
    console.log(`current_sha=${payload.current.sha || 'unknown'}`);
    console.log(`current_version=${payload.current.version || 'unknown'}`);
    console.log(`target_sha=${payload.target_sha}`);
    console.log(`backup_dir=${payload.backup_dir}`);
    if (payload.run_with) console.log(`run_with=${payload.run_with}`);
  }
}

function fail(status, message) {
  print({ status, message });
  process.exit(2);
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function redact(value) {
  return String(value)
    .replace(/gbrain_(?:cs|at|rt|code)_[A-Za-z0-9_-]+/g, '<redacted-gbrain-secret>')
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '<redacted-db-url>')
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, '<redacted-api-key>');
}
