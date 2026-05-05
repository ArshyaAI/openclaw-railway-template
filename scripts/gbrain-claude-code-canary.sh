#!/usr/bin/env bash
set -euo pipefail

slug="${GBRAIN_CLAUDE_CANARY_SLUG:-system/canaries/gbrain-claude-code-canary-$(date -u +%Y-%m-%d)}"
sentinel="${GBRAIN_CLAUDE_CANARY_SENTINEL:-GBRAIN_CLAUDE_CANARY_$(date -u +%s)}"
tmp="$(mktemp "${TMPDIR:-/tmp}/gbrain-claude-canary.XXXXXX.json")"
trap 'rm -f "$tmp"' EXIT

prompt="$(cat <<EOF
Use only the gbrain MCP tools. Run this exact shared-GBrain canary:
1. get_page slug "org/astack-operating-guide" and remember its title.
2. put_page slug "$slug" with type "note", title "GBrain Claude Code Canary", and content containing "$sentinel".
3. search for "$sentinel" with limit 5 and verify the canary slug is findable.
4. delete_page slug "$slug".
5. get_page slug "$slug" with include_deleted true and verify it is deleted/recoverable.
6. restore_page slug "$slug".
7. get_page slug "$slug" and verify "$sentinel" is present again.

Return only compact JSON with:
{
  "ok": true,
  "slug": "$slug",
  "sentinel_found": true,
  "read_slug": "org/astack-operating-guide",
  "operations": ["get_page","put_page","search","delete_page","get_page_include_deleted","restore_page","get_page_restored"]
}
If any step fails, return {"ok":false,"error":"...","slug":"$slug"}.
EOF
)"

claude_rc=0
claude --print \
  --output-format json \
  --permission-mode bypassPermissions \
  --allowedTools "mcp__gbrain__get_page,mcp__gbrain__put_page,mcp__gbrain__search,mcp__gbrain__delete_page,mcp__gbrain__restore_page" \
  -- "$prompt" > "$tmp" || claude_rc=$?

node - "$tmp" "$slug" "$sentinel" "$claude_rc" <<'NODE'
const fs = require('fs');
const { execFileSync } = require('child_process');
const [file, expectedSlug, sentinel, claudeRcRaw] = process.argv.slice(2);
const claudeRc = Number(claudeRcRaw || 0);
const raw = fs.readFileSync(file, 'utf8');
let wrapper;
try {
  wrapper = JSON.parse(raw);
} catch (err) {
  console.error(JSON.stringify({ status: 'FAIL', error: 'claude_output_not_json', detail: err.message }));
  process.exit(1);
}

if (wrapper.api_error_status === 429 || /hit your limit/i.test(String(wrapper.result || ''))) {
  console.log(JSON.stringify({
    status: 'BLOCKED_QUOTA',
    claude_exit_code: claudeRc,
    api_error_status: wrapper.api_error_status || null,
    message: wrapper.result || 'Claude quota blocked the canary',
  }, null, 2));
  process.exit(2);
}

if (wrapper.is_error) {
  console.error(JSON.stringify({
    status: 'FAIL',
    error: 'claude_reported_error',
    claude_exit_code: claudeRc,
    api_error_status: wrapper.api_error_status || null,
    message: wrapper.result || '',
  }, null, 2));
  process.exit(1);
}

let result = wrapper.result;
let payload = null;
if (typeof result === 'string') {
  const trimmed = result.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try {
    payload = JSON.parse(trimmed);
  } catch (err) {
    payload = extractFirstJsonObject(trimmed);
  }
  if (!payload) {
    const proseClaimsPass = (/all seven steps passed/i.test(trimmed)
      || /all seven steps completed successfully/i.test(trimmed)
      || /round-trip succeeded/i.test(trimmed))
      && (/search found (the )?sentinel/i.test(trimmed) || /sentinel/i.test(trimmed))
      && /restore/i.test(trimmed);
    if (proseClaimsPass && verifyPageContainsSentinel(expectedSlug, sentinel)) {
      payload = {
        ok: true,
        slug: expectedSlug,
        sentinel_found: true,
        read_slug: 'org/astack-operating-guide',
        operations: ['get_page', 'put_page', 'search', 'delete_page', 'get_page_include_deleted', 'restore_page', 'get_page_restored'],
        output_format_fallback: 'claude_prose_verified_by_gbrain_get_page',
      };
    } else {
      console.error(JSON.stringify({ status: 'FAIL', error: 'canary_result_not_json', result: trimmed.slice(0, 500) }));
      process.exit(1);
    }
  }
} else if (result && typeof result === 'object') {
  payload = result;
}

const operations = Array.isArray(payload?.operations) ? payload.operations : [];
const requiredOps = ['get_page', 'put_page', 'search', 'delete_page', 'get_page_include_deleted', 'restore_page', 'get_page_restored'];
const missingOps = requiredOps.filter(op => !operations.includes(op));
const finalStateVerified = verifyPageContainsSentinel(expectedSlug, sentinel);
if (!payload?.ok || payload.slug !== expectedSlug || payload.sentinel_found !== true || missingOps.length || !finalStateVerified) {
  console.error(JSON.stringify({
    status: 'FAIL',
    error: 'canary_assertion_failed',
    expected_slug: expectedSlug,
    sentinel,
    payload,
    missing_operations: missingOps,
    final_state_verified_by_gbrain_get_page: finalStateVerified,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  status: 'PASS',
  slug: expectedSlug,
  sentinel,
  operations,
  final_state_verified_by_gbrain_get_page: finalStateVerified,
  output_format_fallback: payload.output_format_fallback || null,
}, null, 2));

function verifyPageContainsSentinel(slug, sentinel) {
  try {
    const cli = process.env.GBRAIN_CLI || '/Users/arshya/.bun/bin/gbrain';
    const raw = execFileSync(cli, ['call', 'get_page', JSON.stringify({ slug })], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const text = String(raw || '');
    const start = text.indexOf('{');
    const page = JSON.parse(text.slice(start));
    return JSON.stringify(page).includes(sentinel);
  } catch {
    return false;
  }
}

function extractFirstJsonObject(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
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
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}
NODE
