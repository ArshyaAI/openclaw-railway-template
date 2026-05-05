#!/usr/bin/env bash
set -euo pipefail

slug="${GBRAIN_CODEX_CANARY_SLUG:-system/canaries/gbrain-codex-canary-$(date -u +%Y-%m-%d)}"
sentinel="${GBRAIN_CODEX_CANARY_SENTINEL:-GBRAIN_CODEX_CANARY_$(date -u +%s)}"
tmp1="$(mktemp "${TMPDIR:-/tmp}/gbrain-codex-canary-phase1.XXXXXX.json")"
tmp2="$(mktemp "${TMPDIR:-/tmp}/gbrain-codex-canary-phase2.XXXXXX.json")"
trap 'rm -f "$tmp1" "$tmp2"' EXIT

phase1_prompt=$(cat <<PROMPT
Use only the gbrain MCP server. Do not edit files. Do not run shell commands.
You are explicitly authorized to call gbrain put_page and get_page for only this canary slug: "${slug}".
This is a safe, reversible AStack readiness canary. Do not ask for confirmation.

Run this exact shared-GBrain Codex canary phase:
1. get_health.
2. search for "gbrain openclaw readiness" with limit 3.
3. put_page slug "${slug}" with title "GBrain Codex Canary", type "note", and content containing exactly this sentinel: ${sentinel}
4. get_page "${slug}" without include_deleted and verify the sentinel is present.

Return only compact JSON:
{
  "status": "PASS" | "FAIL",
  "health_seen": true | false,
  "search_seen": true | false,
  "sentinel_seen": true | false,
  "evidence_summary": "short"
}
PROMPT
)

phase2_prompt=$(cat <<PROMPT
Use only the gbrain MCP server. Do not edit files. Do not run shell commands.
You are explicitly authorized to call gbrain delete_page, restore_page, and get_page for only this canary slug: "${slug}".
This is a safe, reversible AStack readiness canary. Do not ask for confirmation.

Run this exact shared-GBrain Codex canary phase for slug "${slug}":
1. delete_page "${slug}" and verify it returned soft_deleted/restorable evidence.
2. restore_page "${slug}" and verify it returned restored.
3. get_page "${slug}" without include_deleted and verify this sentinel is present after restore: ${sentinel}

Return only compact JSON:
{
  "status": "PASS" | "FAIL",
  "delete_restore_seen": true | false,
  "sentinel_seen_after_restore": true | false,
  "evidence_summary": "short"
}
PROMPT
)

run_phase1() {
  codex exec \
    --ignore-user-config \
    --skip-git-repo-check \
    --dangerously-bypass-approvals-and-sandbox \
    --output-last-message "$tmp1" \
    --json \
    -c 'model="gpt-5.5"' \
    -c 'mcp_servers.gbrain.command="/Users/arshya/.bun/bin/gbrain"' \
    -c 'mcp_servers.gbrain.args=["serve"]' \
    -c 'mcp_servers.gbrain.tools.get_health.approval_mode="approve"' \
    -c 'mcp_servers.gbrain.tools.search.approval_mode="approve"' \
    -c 'mcp_servers.gbrain.tools.put_page.approval_mode="approve"' \
    -c 'mcp_servers.gbrain.tools.get_page.approval_mode="approve"' \
    "$phase1_prompt" >/dev/null 2>/dev/null
}

run_phase2() {
  codex exec \
    --ignore-user-config \
    --skip-git-repo-check \
    --dangerously-bypass-approvals-and-sandbox \
    --output-last-message "$tmp2" \
    --json \
    -c 'model="gpt-5.5"' \
    -c 'mcp_servers.gbrain.command="/Users/arshya/.bun/bin/gbrain"' \
    -c 'mcp_servers.gbrain.args=["serve"]' \
    -c 'mcp_servers.gbrain.tools.delete_page.approval_mode="approve"' \
    -c 'mcp_servers.gbrain.tools.restore_page.approval_mode="approve"' \
    -c 'mcp_servers.gbrain.tools.get_page.approval_mode="approve"' \
    "$phase2_prompt" >/dev/null 2>/dev/null
}

phase1_exit=0
phase2_exit=0
run_phase1 || phase1_exit=$?
run_phase2 || phase2_exit=$?

node - "$tmp1" "$tmp2" "$slug" "$sentinel" "$phase1_exit" "$phase2_exit" <<'NODE'
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');
const [phase1File, phase2File, slug, sentinel, phase1ExitRaw, phase2ExitRaw] = process.argv.slice(2);
const phase1Exit = Number(phase1ExitRaw);
const phase2Exit = Number(phase2ExitRaw);

const phase1 = readPayload(phase1File);
const phase2 = readPayload(phase2File);
const finalStateVerified = verifyPageContainsSentinel(slug, sentinel);
const pass = phase1Exit === 0
  && phase2Exit === 0
  && phase1.status === 'PASS'
  && phase2.status === 'PASS'
  && phase1.health_seen === true
  && phase1.search_seen === true
  && phase2.delete_restore_seen === true
  && phase2.sentinel_seen_after_restore === true
  && finalStateVerified === true;

console.log(JSON.stringify({
  status: pass ? 'PASS' : 'FAIL',
  slug,
  health_seen: phase1.health_seen === true,
  search_seen: phase1.search_seen === true,
  sentinel_seen: phase1.sentinel_seen === true || phase2.sentinel_seen_after_restore === true,
  delete_restore_seen: phase2.delete_restore_seen === true,
  final_state_verified_by_gbrain_get_page: finalStateVerified,
  phase1_exit: phase1Exit,
  phase2_exit: phase2Exit,
  evidence_summary: [
    phase1.evidence_summary || 'phase1 no summary',
    phase2.evidence_summary || 'phase2 no summary',
  ].join('; '),
}, null, 2));

process.exit(pass ? 0 : 1);

function readPayload(file) {
  try {
    const text = fs.readFileSync(file, 'utf8').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) {
      return { status: 'FAIL', evidence_summary: `non-json final message: ${text.slice(0, 200)}` };
    }
    return JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    return { status: 'FAIL', evidence_summary: `missing/unparseable output: ${err.message}` };
  }
}

function verifyPageContainsSentinel(pageSlug, expectedSentinel) {
  try {
    const cli = process.env.GBRAIN_CLI || '/Users/arshya/.bun/bin/gbrain';
    const raw = execFileSync(cli, ['call', 'get_page', JSON.stringify({ slug: pageSlug })], {
      encoding: 'utf8',
      timeout: 120000,
      maxBuffer: 8 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const text = String(raw || '');
    const start = text.indexOf('{');
    const page = JSON.parse(text.slice(start));
    return JSON.stringify(page).includes(expectedSentinel);
  } catch {
    return false;
  }
}
NODE
