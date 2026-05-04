#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const TARGET_PROJECT_ID = 'fbdb217b-060f-4f1e-8697-08a6288a19c4';
const TARGET_ENVIRONMENT = 'production';
const TARGET_SERVICE_ID = '6f333a2b-07d9-4219-8531-3b96fbc6a2f9';
const TARGET_SERVICE_NAME = 'openclaw-railway-template';
const FORBIDDEN_SERVICE_ID = '63b84308-25d7-4b03-9c23-4d0d7239728f';

const args = new Set(process.argv.slice(2));
const json = args.has('--json');
const includeRuntime = !args.has('--no-runtime');
const localCheckout = process.env.GBRAIN_LOCAL_CHECKOUT || '/Users/arshya/gbrain';

const evidence = [];
const warnings = [];

const remoteSha = run(['git', ['ls-remote', 'https://github.com/garrytan/gbrain.git', 'refs/heads/master']])
  ?.split(/\s+/)[0] || null;
const pinnedDockerSha = readRegex('services/gbrain-remote-mcp/Dockerfile', /ARG GBRAIN_UPSTREAM_SHA=([0-9a-f]{40})/);
const pinnedVerifierSha = readRegex('scripts/verify-gbrain-openclaw-readiness.sh', /UPSTREAM_GBRAIN_SHA="([0-9a-f]{40})"/);
const localHead = run(['git', ['-C', localCheckout, 'rev-parse', 'HEAD']]);
const localOrigin = run(['git', ['-C', localCheckout, 'rev-parse', 'origin/master']]);
const localPackageVersion = readJsonPackage(path.join(localCheckout, 'package.json'));
const upstreamPackageVersion = remoteSha ? await readGitHubPackageVersion(remoteSha) : null;
const npmPackageVersion = run(['npm', ['view', 'gbrain', 'version', '--json']]);
const runtime = includeRuntime ? readRuntime() : null;

compare('docker_pin_vs_upstream', pinnedDockerSha, remoteSha);
compare('verifier_pin_vs_upstream', pinnedVerifierSha, remoteSha);
compare('local_origin_vs_upstream', localOrigin, remoteSha);
if (runtime?.sha) compare('runtime_sha_vs_upstream', runtime.sha, remoteSha);
if (runtime?.version && upstreamPackageVersion) compare('runtime_version_vs_upstream_package', normalizeVersion(runtime.version), upstreamPackageVersion);
if (localPackageVersion && upstreamPackageVersion) compare('local_package_vs_upstream_package', localPackageVersion, upstreamPackageVersion);

const result = {
  status: warnings.length ? 'WARN' : 'PASS',
  checked_at: new Date().toISOString(),
  upstream: {
    repo: 'https://github.com/garrytan/gbrain',
    branch: 'master',
    sha: remoteSha,
    package_version: upstreamPackageVersion,
    npm_package_version: npmPackageVersion ? stripJsonString(npmPackageVersion) : null,
    npm_package_note: 'advisory only; GitHub source SHA/package.json remain authoritative for garrytan/gbrain',
  },
  pins: {
    docker_arg: pinnedDockerSha,
    verifier: pinnedVerifierSha,
  },
  local: {
    checkout: localCheckout,
    head: localHead,
    origin_master: localOrigin,
    package_version: localPackageVersion,
  },
  runtime,
  evidence,
  warnings,
  upgrade_policy: [
    'approval required',
    'backup runtime /data/gbrain and config before upgrade',
    'run migrations explicitly',
    'run full doctor',
    'run direct, OpenClaw, remote MCP, and local-agent canaries',
    'rollback to recorded backup on failed doctor or canary',
  ],
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`status=${result.status}`);
  console.log(`upstream_sha=${remoteSha || 'unknown'}`);
  console.log(`upstream_package_version=${upstreamPackageVersion || 'unknown'}`);
  console.log(`pinned_docker_sha=${pinnedDockerSha || 'unknown'}`);
  console.log(`pinned_verifier_sha=${pinnedVerifierSha || 'unknown'}`);
  console.log(`local_head=${localHead || 'unknown'}`);
  console.log(`local_origin_master=${localOrigin || 'unknown'}`);
  if (runtime) {
    console.log(`runtime_service=${runtime.service_name} (${runtime.service_id})`);
    console.log(`runtime_sha=${runtime.sha || 'unknown'}`);
    console.log(`runtime_version=${runtime.version || 'unknown'}`);
  }
  for (const item of evidence) console.log(`check=${item.name} expected=${item.expected || 'unknown'} actual=${item.actual || 'unknown'} status=${item.status}`);
  for (const warning of warnings) console.log(`WARN ${warning}`);
}

function readRegex(relativePath, regex) {
  const text = readFileSync(path.join(ROOT, relativePath), 'utf8');
  return text.match(regex)?.[1] || null;
}

function readJsonPackage(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8')).version || null;
  } catch {
    return null;
  }
}

async function readGitHubPackageVersion(sha) {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/garrytan/gbrain/${sha}/package.json`);
    if (!res.ok) return null;
    return (await res.json()).version || null;
  } catch {
    return null;
  }
}

function readRuntime() {
  if (TARGET_SERVICE_ID === FORBIDDEN_SERVICE_ID) {
    throw new Error('refusing forbidden Railway service id');
  }
  const command = [
    'env HOME=/data GBRAIN_HOME=/data BRAIN_REPO=/data/brain BUN_INSTALL=/data/.bun PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    'sh -lc',
    quote('cd /data/gbrain && printf "service_name=' + TARGET_SERVICE_NAME + '\\nservice_id=' + TARGET_SERVICE_ID + '\\nsha=" && git rev-parse HEAD && printf "version=" && /data/.bun/bin/gbrain --version'),
  ].join(' ');
  const text = run(['railway', [
    'ssh',
    '--project', TARGET_PROJECT_ID,
    '--environment', TARGET_ENVIRONMENT,
    '--service', TARGET_SERVICE_ID,
    command,
  ]]);
  if (!text) return null;
  const values = Object.fromEntries(text.split(/\r?\n/).map((line) => {
    const idx = line.indexOf('=');
    return idx === -1 ? null : [line.slice(0, idx), line.slice(idx + 1)];
  }).filter(Boolean));
  return {
    service_name: values.service_name || TARGET_SERVICE_NAME,
    service_id: values.service_id || TARGET_SERVICE_ID,
    sha: values.sha || null,
    version: values.version || null,
  };
}

function run([cmd, cmdArgs]) {
  try {
    return execFileSync(cmd, cmdArgs, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
    }).trim();
  } catch {
    return null;
  }
}

function compare(name, actual, expected) {
  const status = actual && expected && actual === expected ? 'PASS' : 'WARN';
  evidence.push({ name, actual, expected, status });
  if (status !== 'PASS') {
    warnings.push(`${name}: expected ${expected || 'unknown'}, got ${actual || 'unknown'}`);
  }
}

function normalizeVersion(value) {
  return String(value || '').replace(/^gbrain\s+/, '').trim();
}

function stripJsonString(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function quote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}
