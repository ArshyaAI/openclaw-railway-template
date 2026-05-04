#!/usr/bin/env node
import { execFileSync } from 'node:child_process';

const PROJECT_ID = 'fbdb217b-060f-4f1e-8697-08a6288a19c4';
const ENVIRONMENT = 'production';
const TARGET_SERVICE_ID = '6f333a2b-07d9-4219-8531-3b96fbc6a2f9';
const TARGET_SERVICE_NAME = 'openclaw-railway-template';
const FORBIDDEN_SERVICE_ID = '63b84308-25d7-4b03-9c23-4d0d7239728f';
const APPROVAL_PHRASE = 'openclaw-gbrain-frontmatter-fix';

const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
const json = args.has('--json');
const rollbackArg = process.argv.find((arg) => arg.startsWith('--rollback='));
const rollbackDir = rollbackArg ? rollbackArg.slice('--rollback='.length) : null;
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = rollbackDir || `/data/backups/gbrain-frontmatter-fix/${stamp}`;

if (TARGET_SERVICE_ID === FORBIDDEN_SERVICE_ID) {
  fail('BLOCKED_FORBIDDEN_SERVICE_RISK', 'refusing forbidden Railway service id');
}

const approved = process.env.GBRAIN_FRONTMATTER_FIX_APPROVED === APPROVAL_PHRASE;
const mode = rollbackDir ? 'rollback' : execute ? 'execute' : 'plan';
const base = {
  target: {
    project_id: PROJECT_ID,
    environment: ENVIRONMENT,
    service_name: TARGET_SERVICE_NAME,
    service_id: TARGET_SERVICE_ID,
  },
  mode,
  approval_required: APPROVAL_PHRASE,
  approved,
  backup_dir: backupDir,
  expected_impact: [
    'mutates only syncable Markdown files under /data/sources on the approved OpenClaw target service',
    'does not run root-wide gbrain frontmatter generate; only files with parseMarkdown audit errors are candidates',
    'does not restart, redeploy, mutate Railway variables, or touch the forbidden NIKIN production service',
    'writes a central backup copy and manifest before each file rewrite',
  ],
  rollback: [
    `GBRAIN_FRONTMATTER_FIX_APPROVED=${APPROVAL_PHRASE} npm run fix:gbrain-frontmatter-runtime -- --rollback=${backupDir} --json`,
    'or manually copy each manifest backup_file back to original path',
  ],
  post_execute_checks: [
    'gbrain frontmatter audit --json',
    'gbrain doctor --json',
    'npm run verify:gbrain-full-pass-gates -- --json',
  ],
};

if ((execute || rollbackDir) && !approved) {
  print({
    status: 'BLOCKED_APPROVAL_REQUIRED',
    ...base,
    run_with: rollbackDir
      ? `GBRAIN_FRONTMATTER_FIX_APPROVED=${APPROVAL_PHRASE} npm run fix:gbrain-frontmatter-runtime -- --rollback=${backupDir} --json`
      : `GBRAIN_FRONTMATTER_FIX_APPROVED=${APPROVAL_PHRASE} npm run fix:gbrain-frontmatter-runtime -- --execute --json`,
  });
  process.exit(2);
}

const runtimeResult = runRuntime({ execute, rollbackDir, backupDir });
print({
  status: runtimeResult.status,
  ...base,
  runtime: runtimeResult,
});

function runRuntime({ execute: shouldExecute, rollbackDir: rollbackPath, backupDir: backupPath }) {
  const runtimeScript = Buffer.from(buildRuntimeScript(), 'utf8').toString('base64');
  const remote = [
    'set -euo pipefail',
    runtimeEnv(),
    `backup_dir=${quote(backupPath)}`,
    `script_b64=${quote(runtimeScript)}`,
    'tmp_script="/tmp/gbrain-frontmatter-targeted-fix.mjs"',
    'printf "%s" "$script_b64" | base64 -d > "$tmp_script"',
    'chmod 700 "$tmp_script"',
    rollbackPath
      ? `bun "$tmp_script" --rollback ${quote(rollbackPath)} --json`
      : `bun "$tmp_script" --backup-dir "$backup_dir" ${shouldExecute ? '--execute' : '--dry-run'} --json`,
  ].join('\n');
  const text = railwaySsh(['bash -lc', quote(remote)].join(' '), { timeout: 900_000 });
  return parseRuntimeJson(text);
}

function buildRuntimeScript() {
  return String.raw`#!/usr/bin/env bun
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const execute = args.includes('--execute');
const dryRun = args.includes('--dry-run') || !execute;
const json = args.includes('--json');
const rollbackIdx = args.indexOf('--rollback');
const rollbackDir = rollbackIdx >= 0 ? args[rollbackIdx + 1] : null;
const backupIdx = args.indexOf('--backup-dir');
const backupDir = backupIdx >= 0 ? args[backupIdx + 1] : null;
const gbrainRoot = process.env.GBRAIN_RUNTIME_ROOT || '/data/gbrain';

const { parseMarkdown } = await import(pathToFileURL(join(gbrainRoot, 'src/core/markdown.ts')).href);
const { isSyncable, slugifyPath } = await import(pathToFileURL(join(gbrainRoot, 'src/core/sync.ts')).href);
const { inferFrontmatter, serializeFrontmatter } = await import(pathToFileURL(join(gbrainRoot, 'src/core/frontmatter-inference.ts')).href);
const { autoFixFrontmatter } = await import(pathToFileURL(join(gbrainRoot, 'src/core/brain-writer.ts')).href);

if (rollbackDir) {
  print(rollback(rollbackDir));
  process.exit(0);
}

if (!backupDir) {
  throw new Error('--backup-dir is required');
}

const sources = readSources()
  .filter((source) => source.local_path && source.local_path.startsWith('/data/sources/') && existsSync(source.local_path));

const result = {
  status: execute ? 'EXECUTED' : 'PLAN',
  dry_run: dryRun,
  backup_dir: backupDir,
  sources_scanned: sources.length,
  files_scanned: 0,
  issue_files: 0,
  changed_files: 0,
  remaining_issue_files: 0,
  errors_before_by_code: {},
  fixes_by_code: {},
  remaining_by_code: {},
  changed_by_source: {},
  remaining_by_source: {},
  samples: {
    changed: [],
    remaining: [],
  },
};

const manifest = [];

for (const source of sources) {
  const root = resolve(source.local_path);
  for (const absPath of walk(root)) {
    const relPath = relative(root, absPath);
    if (!isSyncable(relPath, { strategy: 'markdown' })) continue;
    result.files_scanned += 1;

    const original = readFileSync(absPath, 'utf8');
    const before = validate(original, relPath);
    if (!before.length) continue;

    result.issue_files += 1;
    for (const code of before) inc(result.errors_before_by_code, code);

    let next = original;
    const fixes = [];

    if (before.includes('MISSING_OPEN')) {
      const inferred = inferFrontmatter(relPath, next);
      if (!inferred.skipped) {
        next = serializeFrontmatter(inferred) + '\n' + next;
        fixes.push({ code: 'MISSING_OPEN', method: 'generate' });
      }
    }

    const afterGenerate = validate(next, relPath);
    if (afterGenerate.length) {
      const fixed = autoFixFrontmatter(next, { filePath: relPath });
      if (fixed.fixes.length) {
        next = fixed.content;
        for (const fix of fixed.fixes) fixes.push({ code: fix.code, method: 'autoFixFrontmatter' });
      }
    }

    const afterAutoFix = validate(next, relPath);
    if (afterAutoFix.includes('NESTED_QUOTES')) {
      const fixed = fixNestedQuoteLines(next);
      if (fixed.changed) {
        next = fixed.content;
        fixes.push({ code: 'NESTED_QUOTES', method: 'flowYamlQuoteRewrite' });
      }
    }

    const afterQuoteFix = validate(next, relPath);
    if (before.includes('YAML_PARSE') || afterQuoteFix.includes('YAML_PARSE')) {
      const fixed = fixYamlScalarLines(next);
      if (fixed.changed) {
        next = fixed.content;
        fixes.push({ code: 'YAML_PARSE', method: 'frontmatterScalarQuote' });
      }
    }

    const remaining = validate(next, relPath);
    if (next !== original && fixes.length) {
      result.changed_files += 1;
      result.changed_by_source[source.id] = (result.changed_by_source[source.id] || 0) + 1;
      for (const fix of fixes) inc(result.fixes_by_code, fix.code);
      const backupFile = join(backupDir, 'files', source.id, relPath + '.orig');
      manifest.push({ source_id: source.id, path: absPath, rel_path: relPath, backup_file: backupFile, fixes, remaining });
      if (result.samples.changed.length < 20) {
        result.samples.changed.push({ source_id: source.id, rel_path: relPath, fixes: fixes.map((fix) => fix.code), remaining });
      }
      if (execute) {
        mkdirSync(dirname(backupFile), { recursive: true });
        copyFileSync(absPath, backupFile);
        writeFileSync(absPath, next, 'utf8');
      }
    }

    if (remaining.length) {
      result.remaining_issue_files += 1;
      result.remaining_by_source[source.id] = (result.remaining_by_source[source.id] || 0) + 1;
      for (const code of remaining) inc(result.remaining_by_code, code);
      if (result.samples.remaining.length < 20) {
        result.samples.remaining.push({ source_id: source.id, rel_path: relPath, before, remaining });
      }
    }
  }
}

if (execute) {
  mkdirSync(backupDir, { recursive: true });
  writeFileSync(join(backupDir, 'manifest.json'), JSON.stringify({ generated_at: new Date().toISOString(), manifest }, null, 2));
  writeFileSync(join(backupDir, 'summary.json'), JSON.stringify(result, null, 2));
}

print(result);

function readSources() {
  const out = execFileSync('/data/.bun/bin/gbrain', ['sources', 'list', '--json'], {
    encoding: 'utf8',
    env: process.env,
  });
  const parsed = JSON.parse(out);
  return parsed.sources || parsed;
}

function validate(content, relPath) {
  const expectedSlug = slugifyPath(relPath);
  const parsed = parseMarkdown(content, relPath, { validate: true, expectedSlug });
  return (parsed.errors || []).map((error) => error.code);
}

function fixNestedQuoteLines(content) {
  const lines = content.split('\n');
  let firstNonEmpty = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim()) {
      firstNonEmpty = i;
      break;
    }
  }
  if (firstNonEmpty < 0 || lines[firstNonEmpty].trim() !== '---') {
    return { content, changed: false };
  }
  let closeIdx = -1;
  for (let i = firstNonEmpty + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) return { content, changed: false };

  let changed = false;
  for (let i = firstNonEmpty + 1; i < closeIdx; i += 1) {
    const quoteCount = (lines[i].match(/"/g) || []).length;
    if (quoteCount < 3) continue;
    lines[i] = lines[i].replace(/'/g, "''").replace(/"/g, "'");
    changed = true;
  }
  return { content: lines.join('\n'), changed };
}

function fixYamlScalarLines(content) {
  const lines = content.split('\n');
  let firstNonEmpty = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].trim()) {
      firstNonEmpty = i;
      break;
    }
  }
  if (firstNonEmpty < 0 || lines[firstNonEmpty].trim() !== '---') {
    return { content, changed: false };
  }
  let closeIdx = -1;
  for (let i = firstNonEmpty + 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') {
      closeIdx = i;
      break;
    }
  }
  if (closeIdx < 0) return { content, changed: false };

  let changed = false;
  for (let i = firstNonEmpty + 1; i < closeIdx; i += 1) {
    const match = lines[i].match(/^(\s*(?:title|name)\s*:\s*)([^'"][^#\n]*?)\s*$/);
    if (!match) continue;
    const [, prefix, rawValue] = match;
    const value = rawValue.trim();
    if (!value || value === '|' || value === '>' || value.startsWith('[') || value.startsWith('{')) continue;
    if (!'!&*@{}[],#|>%'.includes(value[0])) continue;
    lines[i] = prefix + "'" + value.replace(/'/g, "''") + "'";
    changed = true;
  }
  return { content: lines.join('\n'), changed };
}

function* walk(root) {
  const stack = [root];
  const visited = new Set();
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try {
        st = lstatSync(full);
      } catch {
        continue;
      }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        const real = resolve(full);
        if (visited.has(real)) continue;
        visited.add(real);
        stack.push(full);
      } else if (st.isFile()) {
        yield full;
      }
    }
  }
}

function rollback(dir) {
  const manifestPath = join(dir, 'manifest.json');
  if (!existsSync(manifestPath)) {
    throw new Error('manifest not found: ' + manifestPath);
  }
  const payload = JSON.parse(readFileSync(manifestPath, 'utf8'));
  let restored = 0;
  for (const item of payload.manifest || []) {
    if (!existsSync(item.backup_file)) continue;
    copyFileSync(item.backup_file, item.path);
    restored += 1;
  }
  return { status: 'ROLLED_BACK', backup_dir: dir, restored_files: restored };
}

function inc(obj, key) {
  obj[key] = (obj[key] || 0) + 1;
}

function print(payload) {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else console.log(payload.status);
}
`;
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
  return 'export HOME=/data GBRAIN_HOME=/data BRAIN_REPO=/data/brain BUN_INSTALL=/data/.bun PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
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

function parseRuntimeJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error(`runtime did not emit JSON: ${text.slice(0, 500)}`);
  }
  return JSON.parse(text.slice(start, end + 1));
}

function print(payload) {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`status=${payload.status}`);
    console.log(`mode=${payload.mode}`);
    console.log(`backup_dir=${payload.backup_dir}`);
    if (payload.runtime) {
      console.log(`changed_files=${payload.runtime.changed_files}`);
      console.log(`remaining_issue_files=${payload.runtime.remaining_issue_files}`);
    }
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
