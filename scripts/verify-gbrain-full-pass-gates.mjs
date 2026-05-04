#!/usr/bin/env node
import { spawnSync } from 'node:child_process';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const skipClaude = args.has('--skip-claude');
const skipCodex = args.has('--skip-codex');
const deadJobCutoff = new Date(process.env.GBRAIN_FULL_PASS_DEAD_JOB_CUTOFF || '2026-05-04T20:04:26Z');
const burnInHoursRequired = Number(process.env.GBRAIN_FULL_PASS_BURN_IN_HOURS || '24');
const codexCanaryTimeoutMs = Number(process.env.GBRAIN_CODEX_CANARY_TIMEOUT_MS || '900000');

const gates = [];

await gate('upstream_pr_619_resolver', checkPullRequest(619, { requireMerged: false }));
await gate('upstream_pr_620_http_auth', checkPullRequest(620, { requireMerged: false }));
await gate('update_flow_currentness', checkUpdateFlow());
await gate('openclaw_runtime_risk_logs', checkRuntimeRiskLogs());
await gate('scheduler_dead_jobs_burn_in', checkSchedulerBurnIn());
if (!skipClaude) {
  await gate('claude_code_shared_gbrain_canary', checkClaudeCanary());
}
if (!skipCodex) {
  await gate('codex_shared_gbrain_canary', checkCodexCanary());
}

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
    'scheduler burn-in window complete with no new dead shell jobs',
    'GBrain runtime doctor ok via consumed PR #619',
    'upstream PR #620 consumed so remote MCP auth is not astack-custom',
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

async function checkPullRequest(number, { requireMerged }) {
  const out = run('gh', ['pr', 'view', String(number), '--repo', 'garrytan/gbrain', '--json', 'number,title,state,mergeable,mergedAt,url']);
  const pr = parseJson(out.stdout);
  if (requireMerged && pr.state !== 'MERGED') {
    return { status: 'BLOCKED', reason: `PR #${number} is ${pr.state}, not MERGED`, evidence: pr };
  }
  if (pr.state === 'MERGED') {
    return { status: 'PASS', reason: `PR #${number} merged`, evidence: pr };
  }
  if (pr.state === 'OPEN' && pr.mergeable === 'MERGEABLE') {
    return { status: 'BLOCKED', reason: `PR #${number} open/mergeable; must land or be consumed for FULL PASS`, evidence: pr };
  }
  return { status: 'WARN', reason: `PR #${number} state=${pr.state} mergeable=${pr.mergeable}`, evidence: pr };
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
  const counts = Object.fromEntries([...out.stdout.matchAll(/current_([a-z_]+)_lines=(\d+)/g)].map(m => [m[1], Number(m[2])]));
  const risk = (counts.token_mismatch || 0) + (counts.sessions_store || 0) + (counts.rate_limit || 0);
  if (risk === 0) {
    return { status: 'PASS', reason: 'no current token/session/rate-limit risk logs', evidence: counts };
  }
  return { status: 'BLOCKED', reason: 'fresh runtime risk logs found', evidence: counts };
}

async function checkSchedulerBurnIn() {
  const out = run('npm', ['run', 'verify:gbrain', '--', '--dead-jobs-readonly'], { timeout: 180_000 });
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
