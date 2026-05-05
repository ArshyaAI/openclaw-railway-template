#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const skipClaude = args.has('--skip-claude');
const skipCodex = args.has('--skip-codex');
const skipRemote = args.has('--skip-remote');
const skipDirect = args.has('--skip-direct');
const deadJobCutoff = new Date(process.env.GBRAIN_FULL_PASS_DEAD_JOB_CUTOFF || '2026-05-04T20:04:26Z');
const burnInHoursRequired = Number(process.env.GBRAIN_FULL_PASS_BURN_IN_HOURS || '24');
const codexCanaryTimeoutMs = Number(process.env.GBRAIN_CODEX_CANARY_TIMEOUT_MS || '900000');
const targetProjectId = 'fbdb217b-060f-4f1e-8697-08a6288a19c4';
const targetEnvironment = 'production';
const targetEnvironmentId = '614198f2-f7ed-4756-ae83-e0dd23943c9d';
const targetServiceId = '6f333a2b-07d9-4219-8531-3b96fbc6a2f9';
const targetServiceName = 'openclaw-railway-template';
const remoteMcpServiceId = 'beab847a-12bb-499e-a44c-bf5d1982924f';
const remoteMcpServiceName = 'gbrain-remote-mcp';
const forbiddenServiceId = '63b84308-25d7-4b03-9c23-4d0d7239728f';

const gates = [];

assertAllowedService(targetServiceId, targetServiceName);
assertAllowedService(remoteMcpServiceId, remoteMcpServiceName);

await gate('upstream_pr_619_resolver', checkPullRequest(619));
await gate('upstream_pr_620_http_auth', checkPullRequest(620));
await gate('upstream_pr_626_stale_embed_source_scope', checkPullRequest(626));
await gate('update_flow_currentness', checkUpdateFlow());
if (!skipRemote) {
  await gate('remote_mcp_oauth_fixture_canary', checkRemoteMcpCanary());
}
if (!skipClaude) {
  await gate('claude_code_shared_gbrain_canary', checkClaudeCanary());
}
if (!skipCodex) {
  await gate('codex_shared_gbrain_canary', checkCodexCanary());
}
if (!skipDirect) {
  await gate('direct_gbrain_live_canary', checkDirectGbrainCanary());
}
await gate('runtime_gbrain_doctor', checkRuntimeDoctor());
await gate('openclaw_runtime_risk_logs', checkRuntimeRiskLogs());
await gate('scheduler_dead_jobs_burn_in', checkSchedulerBurnIn());
await gate('secret_scan_full_diff_and_artifacts', checkSecretScan());

const blockers = gates.filter(g => g.status === 'BLOCKED' || g.status === 'FAIL');
const warnings = gates.filter(g => g.status === 'WARN');
const result = {
  status: blockers.length ? 'BLOCKED' : warnings.length ? 'PASS_WITH_CONCERNS' : 'PASS',
  checked_at: new Date().toISOString(),
  gates,
  blockers: blockers.map(g => ({ gate: g.name, reason: g.reason })),
  warnings: warnings.map(g => ({ gate: g.name, reason: g.reason })),
  full_pass_requires: [
    'Claude Code canary PASS',
    'Codex canary PASS',
    'Direct GBrain live canary PASS',
    'Remote MCP/OAuth fixture canary PASS',
    'scheduler burn-in window complete with no new dead shell jobs',
    'GBrain runtime doctor --json status ok',
    'upstream PR #619 consumed so resolver doctor warnings are not shipped',
    'upstream PR #620 consumed so remote MCP auth is not astack-custom',
    'upstream PR #626 consumed so source-scoped stale embedding is not a runtime cherry-pick',
    'every Railway-backed gate asserts the approved project/environment/service target',
    'full diff and durable readiness artifacts pass secret-pattern scan',
    'approval-gated runtime upgrade to latest safe upstream completed and canaried',
  ],
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`status=${result.status}`);
  for (const item of gates) {
    console.log(`${item.status.padEnd(8)} ${item.name} ${item.reason || ''}`.trimEnd());
  }
}

process.exit(result.status === 'PASS' ? 0 : 2);

async function gate(name, checkPromise) {
  try {
    const check = await checkPromise;
    gates.push({ name, ...check });
  } catch (err) {
    gates.push({ name, status: 'FAIL', reason: err instanceof Error ? err.message : String(err) });
  }
}

async function checkPullRequest(number) {
  const out = run('gh', ['pr', 'view', String(number), '--repo', 'garrytan/gbrain', '--json', 'number,title,state,mergeable,mergedAt,url']);
  const pr = parseJson(out.stdout);
  if (pr.state === 'MERGED') {
    return { status: 'PASS', reason: `PR #${number} merged`, evidence: pr };
  }
  return {
    status: 'BLOCKED',
    reason: `PR #${number} state=${pr.state} mergeable=${pr.mergeable}; must be merged and consumed before FULL PASS`,
    evidence: pr,
  };
}

async function checkUpdateFlow() {
  const out = run('npm', ['run', 'check:gbrain-upstream', '--', '--json'], { timeout: 180_000 });
  const payload = parseJson(stripNpmPrefix(out.stdout));
  if (payload.status === 'PASS') {
    return { status: 'PASS', reason: 'runtime/local/pins match upstream', evidence: summarizeUpdate(payload) };
  }
  const warnings = payload.warnings || [];
  const hardWarnings = warnings.filter((warning) => !warning.startsWith('local_'));
  if (!hardWarnings.length) {
    return { status: 'WARN', reason: 'runtime and pins match upstream; local checkout remains custom/dirty', evidence: summarizeUpdate(payload) };
  }
  return { status: 'BLOCKED', reason: 'GBrain runtime or durable pins still differ from latest upstream', evidence: summarizeUpdate(payload) };
}

async function checkRuntimeRiskLogs() {
  const out = run('npm', ['run', 'verify:gbrain', '--', '--railway-current'], {
    env: { ...process.env, GBRAIN_VERIFY_SINCE: process.env.GBRAIN_VERIFY_SINCE || '30m' },
    timeout: 180_000,
  });
  const targetMismatch = assertVerifierOutputTarget(out.stdout, { requireVerifiedLine: true });
  if (targetMismatch) return targetMismatch;
  const counts = Object.fromEntries([...out.stdout.matchAll(/current_([a-z_]+)_lines=(\d+)/g)].map(m => [m[1], Number(m[2])]));
  const risk = (counts.token_mismatch || 0) + (counts.sessions_store || 0) + (counts.rate_limit || 0);
  if (risk === 0) {
    return { status: 'PASS', reason: 'no current token/session/rate-limit risk logs', evidence: counts };
  }
  return { status: 'BLOCKED', reason: 'fresh runtime risk logs found', evidence: counts };
}

async function checkRemoteMcpCanary() {
  const out = run('npm', ['run', 'canary:gbrain-remote-fixture'], { allowFailure: true, timeout: 420_000 });
  const objects = parseJsonObjects(stripNpmPrefix(out.stdout));
  const payload = objects.find((item) => item && item.status) || {};
  const cleanup = objects.find((item) => item && item.oauth_fixture_clients_revoked === true) || {};
  if (cleanup.remote_mcp_target_verified !== true || cleanup.service_id !== remoteMcpServiceId) {
    return {
      status: 'BLOCKED',
      reason: 'Remote MCP fixture did not prove the approved Railway service target',
      evidence: { cleanup, expected_service_id: remoteMcpServiceId },
    };
  }
  if (payload.status === 'PASS' && cleanup.oauth_fixture_clients_revoked === true) {
    const skipped = (payload.evidence || []).filter((step) => step.status === 'SKIP');
    if (skipped.length) {
      return {
        status: 'WARN',
        reason: 'Remote MCP canary passed but skipped one or more evidence steps',
        evidence: summarizeRemoteMcp(payload, cleanup, skipped),
      };
    }
    return {
      status: 'PASS',
      reason: 'Remote MCP/OAuth fixture canary passed and fixture clients were revoked',
      evidence: summarizeRemoteMcp(payload, cleanup),
    };
  }
  return {
    status: 'FAIL',
    reason: `Remote MCP/OAuth fixture canary status=${payload.status || 'unknown'}`,
    evidence: { payload, cleanup, exit_status: out.status },
  };
}

async function checkDirectGbrainCanary() {
  const out = run('npm', ['run', 'canary:gbrain'], { allowFailure: true, timeout: 900_000 });
  const payload = parseJson(stripNpmPrefix(out.stdout));
  if (payload.status === 'PASS') {
    return {
      status: 'PASS',
      reason: 'direct runtime GBrain live canary passed',
      evidence: summarizeDirectGbrainCanary(payload),
    };
  }
  return {
    status: 'FAIL',
    reason: `direct GBrain canary status=${payload.status || 'unknown'}`,
    evidence: summarizeDirectGbrainCanary(payload),
  };
}

function summarizeDirectGbrainCanary(payload) {
  const evidence = payload.evidence || [];
  const failed = evidence.filter((step) => step.pass === false).map((step) => ({
    name: step.name,
    detail: step.detail,
  }));
  const health = evidence.find((step) => step.name === 'health after embed')?.detail?.sample || null;
  const stats = evidence.find((step) => step.name === 'stats')?.detail?.sample || null;
  return {
    status: payload.status,
    target: payload.target,
    canary_slugs: payload.canary_slugs,
    step_count: evidence.length,
    failed,
    health,
    stats,
  };
}

async function checkRuntimeDoctor() {
  assertAllowedService(targetServiceId, targetServiceName);
  const remote = [
    'env HOME=/data GBRAIN_HOME=/data BRAIN_REPO=/data/brain BUN_INSTALL=/data/.bun PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'bash -lc',
    quote('cd /data/gbrain && /data/.bun/bin/gbrain doctor --json 2>/tmp/gbrain-doctor-progress.log'),
  ].join(' ');
  const out = run('railway', [
    'ssh',
    '--project', targetProjectId,
    '--environment', targetEnvironment,
    '--service', targetServiceId,
    remote,
  ], { timeout: 420_000 });
  const payload = parseLooseJson(out.stdout);
  const warningChecks = (payload.checks || [])
    .filter((check) => check.status !== 'ok')
    .map((check) => ({ name: check.name, status: check.status, message: check.message }));
  const evidence = {
    status: payload.status,
    health_score: payload.health_score,
    warning_checks: warningChecks,
  };
  if (payload.status === 'ok') {
    return { status: 'PASS', reason: 'runtime doctor status ok', evidence };
  }
  return { status: 'BLOCKED', reason: `runtime doctor status=${payload.status || 'unknown'}`, evidence };
}

async function checkSchedulerBurnIn() {
  const out = run('npm', ['run', 'verify:gbrain', '--', '--dead-jobs-readonly'], { timeout: 180_000 });
  const targetMismatch = assertVerifierOutputTarget(out.stdout, { requireVerifiedLine: true });
  if (targetMismatch) return targetMismatch;
  const startedAt = [...out.stdout.matchAll(/Started:\s+([0-9T:.-]+Z)/g)].map(m => new Date(m[1])).filter(d => Number.isFinite(d.getTime()));
  const newerDeadJobs = startedAt.filter(d => d > deadJobCutoff).map(d => d.toISOString());
  const burnInHours = (Date.now() - deadJobCutoff.getTime()) / 3_600_000;
  if (newerDeadJobs.length) {
    return { status: 'FAIL', reason: `dead shell jobs appeared after cutoff ${deadJobCutoff.toISOString()}`, evidence: { cutoff: deadJobCutoff.toISOString(), newerDeadJobs } };
  }
  if (burnInHours < burnInHoursRequired) {
    return {
      status: 'BLOCKED',
      reason: `burn-in ${burnInHours.toFixed(1)}h/${burnInHoursRequired}h complete; no new dead jobs so far`,
      evidence: { cutoff: deadJobCutoff.toISOString(), burnInHours: Number(burnInHours.toFixed(2)), latestDeadJobStartedAt: startedAt[0]?.toISOString() || null },
    };
  }
  return { status: 'PASS', reason: `burn-in ${burnInHours.toFixed(1)}h complete; no new dead jobs`, evidence: { cutoff: deadJobCutoff.toISOString(), burnInHours: Number(burnInHours.toFixed(2)) } };
}

async function checkClaudeCanary() {
  const out = run('npm', ['run', 'canary:gbrain-claude'], { allowFailure: true, timeout: 180_000 });
  const payload = parseJson(stripNpmPrefix(out.stdout));
  if (payload.status === 'PASS') return { status: 'PASS', reason: 'Claude Code completed shared-GBrain canary', evidence: payload };
  if (payload.status === 'BLOCKED_QUOTA') return { status: 'BLOCKED', reason: payload.message || 'Claude quota blocked canary', evidence: payload };
  return { status: 'FAIL', reason: `Claude canary status=${payload.status || 'unknown'}`, evidence: payload };
}

async function checkCodexCanary() {
  const out = run('npm', ['run', 'canary:gbrain-codex'], { allowFailure: true, timeout: codexCanaryTimeoutMs });
  const payload = parseJson(stripNpmPrefix(out.stdout));
  if (payload.status === 'PASS') return { status: 'PASS', reason: 'Codex completed shared-GBrain canary', evidence: payload };
  return { status: 'FAIL', reason: `Codex canary status=${payload.status || 'unknown'}`, evidence: payload };
}

function summarizeUpdate(payload) {
  return {
    status: payload.status,
    upstream: payload.upstream,
    runtime: payload.runtime,
    warnings: payload.warnings || [],
  };
}

function summarizeRemoteMcp(payload, cleanup, skipped = []) {
  const evidence = payload.evidence || [];
  const stepStatus = Object.fromEntries(evidence.map((step) => [step.step, step.status]));
  const authStatuses = Object.fromEntries(
    evidence
      .filter((step) => typeof step.http_status === 'number')
      .map((step) => [step.step, step.http_status]),
  );
  return {
    status: payload.status,
    url: payload.url,
    auth: payload.auth,
    exposed_tool_count: payload.exposed_tool_count,
    canary_slug: payload.canary_slug,
    step_status: stepStatus,
    auth_http_status: authStatuses,
    skipped: skipped.map((step) => ({ step: step.step, reason: step.reason })),
    oauth_fixture_clients_revoked: cleanup.oauth_fixture_clients_revoked === true,
    railway_target: {
      project_id: cleanup.project_id,
      environment: cleanup.environment,
      service_id: cleanup.service_id,
      service_name: cleanup.service_name,
      verified: cleanup.remote_mcp_target_verified === true,
    },
  };
}

async function checkSecretScan() {
  const files = [
    'docs/gbrain-full-pass-readiness-sprint-2026-05-04.md',
    'package.json',
    'scripts/verify-gbrain-full-pass-gates.mjs',
    'scripts/gbrain-live-canary.mjs',
    'scripts/gbrain-claude-code-canary.sh',
    'scripts/gbrain-codex-canary.sh',
    'scripts/gbrain-remote-mcp-canary.mjs',
    'scripts/gbrain-remote-mcp-fixture-canary.sh',
    'services/gbrain-remote-mcp/start-gbrain-http.mjs',
  ];
  const patterns = [
    { name: 'gbrain_token', regex: /gbrain_(?:cs|at|rt|code|cl)_[A-Za-z0-9_-]{16,}/g },
    { name: 'postgres_url', regex: /postgres(?:ql)?:\/\/[^\s'"`]+/gi },
    { name: 'openai_key', regex: /sk-[A-Za-z0-9_-]{20,}/g },
    { name: 'bearer_token', regex: /Bearer\s+[A-Za-z0-9._-]{20,}/gi },
    { name: 'github_token', regex: /gh[pousr]_[A-Za-z0-9_]{20,}/g },
    { name: 'client_secret_literal', regex: /\bclient[_-]?secret\b\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}/gi },
  ];
  const hits = [];
  for (const file of files) {
    const out = run('git', ['show', `HEAD:${file}`], { allowFailure: true });
    const worktree = run('bash', ['-lc', `test -f ${quote(file)} && sed -n '1,20000p' ${quote(file)} || true`], { allowFailure: true });
    const text = worktree.stdout || out.stdout || '';
    scanText(text, file, patterns, hits);
  }
  const diff = run('git', ['diff', '--no-ext-diff', 'HEAD', '--'], { allowFailure: true, timeout: 180_000 });
  scanText(diff.stdout || '', 'git diff HEAD', patterns, hits);
  if (hits.length) {
    return {
      status: 'FAIL',
      reason: 'secret-pattern scan found possible committed/durable secret material',
      evidence: { hits },
    };
  }
  return {
    status: 'PASS',
    reason: 'full diff and durable GBrain readiness artifacts contain no secret-pattern matches',
    evidence: { files_scanned: files.length, patterns: patterns.map((p) => p.name), diff_bytes_scanned: Buffer.byteLength(diff.stdout || '') },
  };
}

function scanText(text, source, patterns, hits) {
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(text)) !== null) {
      if (isAllowedSecretCanaryLiteral(match[0])) continue;
      hits.push({ source, pattern: pattern.name, offset: match.index });
      if (hits.length >= 20) return;
    }
  }
}

function isAllowedSecretCanaryLiteral(value) {
  return /gbrain_bad_token_for_canary|Bearer REDACTED|POSTGRES_URL_REDACTED|sk-REDACTED|gh_REDACTED/i.test(value);
}

function assertAllowedService(serviceId, serviceName) {
  if (!serviceId || serviceId === forbiddenServiceId) {
    throw new Error(`refusing forbidden or empty Railway service id for ${serviceName || 'unknown service'}`);
  }
  const allowed = new Map([
    [targetServiceId, targetServiceName],
    [remoteMcpServiceId, remoteMcpServiceName],
  ]);
  if (allowed.get(serviceId) !== serviceName) {
    throw new Error(`refusing unapproved Railway service target: ${serviceName} (${serviceId})`);
  }
}

function assertVerifierOutputTarget(stdout, { requireVerifiedLine }) {
  const hasProject = stdout.includes(`project=${targetProjectId}`);
  const hasEnvironment = stdout.includes(`environment=${targetEnvironment} (${targetEnvironmentId})`);
  const hasService = stdout.includes(`service=${targetServiceName} (${targetServiceId})`);
  const hasVerified = stdout.includes(`verified_target=${targetServiceName} (${targetServiceId})`);
  if (!hasProject || !hasEnvironment || !hasService || (requireVerifiedLine && !hasVerified)) {
    return {
      status: 'BLOCKED',
      reason: 'Railway verifier output did not prove the approved target service',
      evidence: { hasProject, hasEnvironment, hasService, hasVerified, expected_service_id: targetServiceId },
    };
  }
  return null;
}

function run(cmd, cmdArgs, opts = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: opts.env || process.env,
    timeout: opts.timeout || 120_000,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (result.error) throw result.error;
  if (result.status !== 0 && !opts.allowFailure) {
    throw new Error(`${cmd} ${cmdArgs.join(' ')} failed with ${result.status}: ${stderr || stdout}`.slice(0, 1000));
  }
  return { stdout, stderr, status: result.status };
}

function stripNpmPrefix(text) {
  const start = text.indexOf('{');
  if (start === -1) return text.trim();
  return text.slice(start).trim();
}

function parseJson(text) {
  const cleaned = stripNpmPrefix(text);
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    throw new Error(`failed to parse JSON: ${err.message}; text=${cleaned.slice(0, 500)}`);
  }
}

function parseJsonObjects(text) {
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === '}' && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const raw = text.slice(start, i + 1);
        try {
          objects.push(JSON.parse(raw));
        } catch {
          // Ignore non-JSON brace blocks in command banners.
        }
        start = -1;
      }
    }
  }
  return objects;
}

function parseLooseJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`failed to find JSON object; text=${text.slice(0, 500)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
