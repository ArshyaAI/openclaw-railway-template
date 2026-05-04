# GBrain Full-Pass Readiness Sprint - 2026-05-04

Status: `PASS_WITH_CONCERNS`

This is the astack-owned follow-up sprint for the remaining GBrain full-pass blockers. It continues from `docs/gbrain-resume-readiness-2026-05-04.md` and does not reset the earlier evidence.

## Scope

- OpenClaw target service: `openclaw-railway-template` (`6f333a2b-07d9-4219-8531-3b96fbc6a2f9`)
- Railway project/env: `ravishing-enjoyment` / `production`
- Forbidden service: `NIKIN - MAIN OC INSTANCE [PRODUCTION]` (`63b84308-25d7-4b03-9c23-4d0d7239728f`)
- Remote MCP service code: `services/gbrain-remote-mcp/`
- GBrain upstream: `https://github.com/garrytan/gbrain`

No targeted command inspected, mutated, restarted, deployed, SSHed into, or tailed logs/variables for the forbidden service. A project-level `railway status --json` service listing included the forbidden service name/id while separating the approved Remote MCP target; no further forbidden-service access was performed.

## Hunt-First Diagnosis

| Bucket | Finding |
| --- | --- |
| Already working | OpenClaw target service healthy, GBrain `0.26.6`, stdio MCP configured, supervisor running, direct GBrain canaries previously passed, local Codex MCP present. |
| Working but not FULL PASS | Runtime doctor remains `warnings`; scheduled shell-job health needs 24-48h observation; remote MCP is live-hardened but still carries an astack patch until upstream PR #620 lands. |
| Missing evidence | Claude Code real toolcall is still blocked by Claude quota. |
| Real blockers | Running direct-minions scheduler ignored `enabled:false`; this produced fresh dead shell jobs from disabled OpenClaw-agent wrapper jobs. |
| Security risks | Remote MCP must return clean auth status, keep DCR disabled, keep CORS default-deny, and avoid auth material in logs. |
| Not worth doing now | Custom MCP gateway, broad project rollback, re-enabling OpenClaw-agent scheduled wrappers without quota policy. |

## Workstream Status

| Workstream | Status | Evidence |
| --- | --- | --- |
| 1. Remote MCP hardening | live pass, upstream patch pending | Remote deployment `20fbbae5-5abd-47d5-b95a-7745a14769e6` applies the astack wrapper plus the upstream-aligned `InvalidTokenError` provider patch from PR #620. Full remote canary now passes: missing token `401`, bad token `401`, expired token `401`, revoked client denial `400`, DCR disabled `404`, admin denial `404`, CORS default-deny, log redaction, read-only write denial, tools list, and read/write/search/version/delete/restore. Upstream issue: <https://github.com/garrytan/gbrain/issues/616>. Upstream fix PR: <https://github.com/garrytan/gbrain/pull/620>. |
| 2. Scheduler/quota fix | live patch deployed, post-slot clean, 24-48h monitoring pending | Deployment `44b4da3f-da1e-46b0-b640-d4e42ba731d8` installed the corrected astack-owned scheduler/wrapper. Runtime validate: `enabled_cron=12`, `disabled_cron=7`; scheduler startup logged `skip_disabled_startup` for all 7 disabled OpenClaw-agent wrapper jobs. A post-critical-slot watch at `2026-05-04T20:04:26Z` found no new dead shell jobs after historical job `1781`; fresh logs had 0 token mismatch, 0 session-store churn, and 0 rate-limit lines. `openclaw-agent-job.sh` now defaults to `openai/gpt-5.4` if intentionally enabled and preserves failure exit codes across no-fallback, fallback-success, and fallback-fail paths. |
| 3. Claude Code canary | blocked | `claude mcp list` shows `gbrain` connected, but `claude --print ... mcp__gbrain__get_page` returned `You've hit your limit - resets 2am (Europe/Zurich)`. |
| 4. Doctor warnings upstream route | upstream PR open | Runtime doctor still warns on 37 shipped skill routing misses while pinned to GBrain `0.26.6`. Upstream issue: <https://github.com/garrytan/gbrain/issues/617>. Fix PR: <https://github.com/garrytan/gbrain/pull/619>. In the upstream worktree, the PR makes `resolver_health` `ok` and `routing-eval` 58/58. |
| 5. Update flow automation | pass with version drift concern | Added `npm run check:gbrain-upstream`. It checks upstream SHA/package version, Docker/verifier pins, local checkout, and runtime SHA/version. Current output warns because upstream master is now `058fe695756ed16e43916d907af3845338430156` / `0.26.7`, while Docker/verifier pins remain `9e2093fc9bb6cb46520e58b0c95b807e788d9606` and runtime remains GBrain `0.26.6`. Upgrade remains approval-gated. |
| 6. Remote MCP product interface | live pass with upstream concern | astack keeps upstream `gbrain serve --http`, owns the Railway deploy/env/token policy/canary/rollback layer, and now has live OAuth-backed canary evidence on `gbrain-remote-mcp`. The only remaining concern is that the InvalidTokenError provider fix is astack-applied until PR #620 is landed or consumed upstream. |

## Completion Audit Snapshot

Checked at `2026-05-04T22:14:57Z`. Result: `NOT_FULL_PASS`.

| Requirement | Evidence | Status |
| --- | --- | --- |
| Remote MCP bad/missing/expired bearer tokens return clean auth failures | `npm run canary:gbrain-remote-fixture` passed: missing token `401`, bad token `401`, expired token `401`, revoked client denial `400`. | pass in astack, upstream patch pending |
| Remote MCP DCR, admin route, CORS, log-redaction, scoped write denial covered | Fixture canary passed DCR disabled `404`, admin denial `404`, CORS default-deny, log redaction, and read-only write denial. | pass |
| Remote MCP uses upstream `gbrain serve --http`, not a custom gateway | `services/gbrain-remote-mcp/start-gbrain-http.mjs` launches upstream HTTP serve with environment hardening and a temporary safety patch. | pass with concern |
| Upstream GBrain owns core resolver/auth behavior | PR #619 and PR #620 are open and mergeable, not merged. | blocked |
| Scheduler no longer creates OpenClaw agent-wrapper sessions for migrated jobs | Runtime validate reports `enabled_agent_wrapper_count=0`; disabled wrapper jobs remain disabled. | pass |
| Scheduler quota/cooldown fix has enough burn-in | Gate runner reports only `2.1h/24h` burn-in complete, with no new dead jobs so far. | blocked |
| Claude Code accesses the shared GBrain with a real tool call | `claude mcp list` is connected, but `npm run canary:gbrain-claude` returns `BLOCKED_QUOTA` / `429` until 2am Europe/Zurich. | blocked |
| Codex accesses the shared GBrain with real tool calls | `npm run canary:gbrain-codex` passed health, search, put/get, delete, and restore against the shared GBrain MCP. | pass |
| Runtime GBrain doctor is `ok` | Runtime `gbrain doctor --fast --json` still reports `warnings` from 37 resolver routing misses on GBrain `0.26.6`. | blocked |
| Latest safe GBrain version is used or explicitly pinned | `npm run check:gbrain-upstream -- --json` reports upstream master `058fe695756ed16e43916d907af3845338430156` / `0.26.7`; runtime is `f79cad0...` / `0.26.6`; Docker/verifier pins remain `9e2093...`. | blocked |
| Local GBrain checkout is safe to update | `/Users/arshya/gbrain` is on `codex-gbrain-0.26.6-runtime-patches` with a dirty `src/cli.ts`; do not overwrite it during this sprint. | blocked |
| Runtime health has no current session/token/rate-limit storm | `GBRAIN_VERIFY_SINCE=30m npm run verify:gbrain -- --railway-current` reports current total/token/session/rate-limit lines all `0`. | pass |
| Secrets not committed or printed in durable artifacts | PCRE2 scan over report, fixture script, package.json, and remote canary script returns no token/DB/API-key matches. | pass |
| Forbidden NIKIN production service untouched | No targeted command inspected/mutated/restarted/deployed/SSHed/logged the forbidden service; fixture script refuses its service ID with exit `2`. | pass |

Conclusion: AStack has a working and useful dogfood layer, including live Remote MCP/OAuth. FULL PASS remains blocked by upstream PR landing/consumption, Claude quota reset, scheduler burn-in, and approval-gated GBrain runtime upgrade.

## Changes Made

- Added `patches/direct-minions-scheduler.mjs`.
  - Respects `enabled:false`.
  - Logs disabled jobs at startup.
  - `--validate` reports total/enabled/disabled cron jobs.
  - `--once` refuses disabled jobs unless `--force-disabled` is passed.
- Added `patches/openclaw-agent-job.sh`.
  - Defaults scheduled OpenClaw-agent wrapper jobs to `openai/gpt-5.4`.
  - Supports `OPENCLAW_AGENT_JOB_MODEL` and `OPENCLAW_AGENT_JOB_FALLBACK_MODEL`.
  - Retries fallback on quota/cooldown/rate-limit text if configured.
  - Preserves failing exit codes when the primary run fails and no fallback succeeds.
- Added `scripts/test-openclaw-agent-job.sh`.
  - Covers primary failure without fallback, fallback success, and fallback failure.
- Updated `patches/start-astack.sh`.
  - Installs the astack-owned direct-minions runtime scripts into `/data/.openclaw/cron/bin` at boot, backing up changed files first.
- Updated Remote MCP wrapper patch.
  - Adds a `/mcp` auth error handler that redacts auth failures and returns `401/403`.
  - Wraps the async `/mcp` handler in `try/catch next(err)` before the error middleware.
  - Applies the upstream-aligned OAuth provider `InvalidTokenError` patch from PR #620 so MCP SDK bearer auth returns clean `401 invalid_token` instead of `500`.
- Expanded `scripts/gbrain-remote-mcp-canary.mjs`.
  - Missing token, bad token, DCR disabled, CORS default-deny, admin-route denial, read-only write denial.
  - Env-backed checks for expired token, revoked client, and log redaction sample.
- Added `scripts/gbrain-remote-mcp-fixture-canary.sh` and npm script `canary:gbrain-remote-fixture`.
  - Creates short-lived Remote MCP OAuth fixture clients on the approved `gbrain-remote-mcp` service, runs the full OAuth-backed remote canary, and revokes the fixtures in cleanup.
  - Refuses the forbidden NIKIN production service ID.
- Added `scripts/check-gbrain-upstream.mjs` and npm script `check:gbrain-upstream`.
- Added `scripts/gbrain-runtime-upgrade-gate.mjs` and npm script `upgrade:gbrain-runtime`.
  - Defaults to plan mode.
  - Requires `GBRAIN_RUNTIME_UPGRADE_APPROVED=openclaw-gbrain-runtime-upgrade` for runtime mutation.
  - Captures a backup path, target SHA, expected impact, rollback, and required post-upgrade canaries.
- Added `scripts/gbrain-claude-code-canary.sh` and npm script `canary:gbrain-claude`.
  - Runs the required Claude Code shared-GBrain get/search/write/delete/restore canary.
  - Returns machine-readable `BLOCKED_QUOTA` on Claude 429 instead of failing ambiguously.
- Added `scripts/gbrain-codex-canary.sh` and npm script `canary:gbrain-codex`.
  - Runs a local Codex shared-GBrain MCP canary for health, search, put/get, delete, and restore.
  - Uses a GBrain-only Codex phase for health/search/write/get, then the normal local Codex policy for delete/restore/get because that is the policy users actually dogfood.
- Added `scripts/verify-gbrain-full-pass-gates.mjs` and npm script `verify:gbrain-full-pass-gates`.
  - Aggregates the remaining FULL PASS gates into one machine-readable result.
  - Exits non-zero until Claude canary, scheduler burn-in, upstream PRs, and upgrade gates pass.
- Extended `scripts/verify-gbrain-openclaw-readiness.sh` with scheduler validation and enabled-agent-wrapper count.

## Command Evidence

```bash
git switch -c astack/gbrain-full-pass-readiness
```

```bash
GBRAIN_VERIFY_SINCE=30m npm run verify:gbrain -- --railway-current
# deploy 8f4b1abf-15d0-4052-87e2-348e1555d282 SUCCESS before patch
# current_token_mismatch_lines=0
# current_sessions_store_lines=0
# current_rate_limit_lines=0
```

```bash
npm run verify:gbrain -- --dead-jobs-readonly
# job 1781, 1773, 1764, 1747: openai-codex/gpt-5.5 cooldown / all profiles unavailable
```

```bash
node --check scripts/gbrain-remote-mcp-canary.mjs
node --check scripts/check-gbrain-upstream.mjs
node --check scripts/gbrain-runtime-upgrade-gate.mjs
node --check patches/direct-minions-scheduler.mjs
bash -n patches/start-astack.sh
bash -n patches/openclaw-agent-job.sh
bash -n scripts/verify-gbrain-openclaw-readiness.sh
bash -n scripts/gbrain-remote-mcp-fixture-canary.sh
bash -n scripts/gbrain-codex-canary.sh
npm run test:openclaw-agent-job
```

```bash
GBRAIN_REMOTE_MCP_URL=https://gbrain-remote-mcp-production.up.railway.app npm run canary:gbrain-remote
# FAIL: bad_token expected clean 401/403 auth failure, got 500
```

```bash
railway up --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service beab847a-12bb-499e-a44c-bf5d1982924f \
  --detach \
  --message "harden gbrain remote mcp auth failures"
# deployment 20fbbae5-5abd-47d5-b95a-7745a14769e6
# status SUCCESS, stopped=false
```

```bash
# Created short-lived OAuth fixture clients inside gbrain-remote-mcp, captured
# secrets only in shell variables, ran the canary, and revoked the fixture
# clients immediately after. No client secret was committed.
GBRAIN_REMOTE_MCP_URL=https://gbrain-remote-mcp-production.up.railway.app \
  GBRAIN_REMOTE_OAUTH_CLIENT_ID=<redacted> \
  GBRAIN_REMOTE_OAUTH_CLIENT_SECRET=<redacted> \
  GBRAIN_REMOTE_EXPIRED_MCP_BEARER_TOKEN=<redacted> \
  GBRAIN_REMOTE_REVOKED_OAUTH_CLIENT_ID=<redacted> \
  GBRAIN_REMOTE_REVOKED_OAUTH_CLIENT_SECRET=<redacted> \
  GBRAIN_REMOTE_LOG_SAMPLE_FILE=<temp-log-sample> \
  npm run canary:gbrain-remote
# status=PASS
# exposed_tool_count=38
# missing_token=401, bad_token=401, expired_token_denial=401
# revoked_client_denial=400
# cors_default_deny PASS, dcr_disabled=404, admin_route_denial=404
# log_redaction PASS, read_only_write_denial PASS
# read_write_search_versions_delete_restore PASS
# oauth_fixture_clients_revoked=true
```

```bash
npm run canary:gbrain-remote-fixture
# repeatable wrapper for the same Remote MCP OAuth fixture canary above
# creates temporary OAuth clients on service beab847a-12bb-499e-a44c-bf5d1982924f
# refuses forbidden service 63b84308-25d7-4b03-9c23-4d0d7239728f
# revokes fixture clients through trap cleanup; does not print client secrets
# checked at 2026-05-04T21:20:12Z
# status=PASS
# exposed_tool_count=38
# missing_token=401, bad_token=401, expired_token_denial=401
# revoked_client_denial=400
# cors_default_deny PASS, dcr_disabled=404, admin_route_denial=404
# log_redaction PASS, read_only_write_denial PASS
# read_write_search_versions_delete_restore PASS
# oauth_fixture_clients_revoked=true
```

```bash
GBRAIN_REMOTE_RAILWAY_SERVICE_ID=63b84308-25d7-4b03-9c23-4d0d7239728f \
  bash scripts/gbrain-remote-mcp-fixture-canary.sh
# exit 2
# {"status":"FAIL","error":"refusing forbidden service id"}
```

```bash
rg --pcre2 -n \
  'gbrain_(?:cs|at|rt|code)_[A-Za-z0-9_-]+|postgres(?:ql)?://|sk-[A-Za-z0-9_-]{20,}|Bearer\s+(?!gbrain_bad_token_for_canary)[A-Za-z0-9._-]+' \
  docs/gbrain-full-pass-readiness-sprint-2026-05-04.md \
  scripts/gbrain-remote-mcp-fixture-canary.sh \
  package.json \
  scripts/gbrain-remote-mcp-canary.mjs
# no matches
```

```bash
railway ssh --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service beab847a-12bb-499e-a44c-bf5d1982924f \
  'sh' '-lc' 'cd /app && bun run src/cli.ts auth revoke-client "<accidental-help-client-id>"'
# revoked accidental client created by an invalid auth-help probe
# tokens and authorization codes purged via cascade
```

```bash
GBRAIN_VERIFY_SINCE=30m npm run verify:gbrain -- --railway-current
# checked after remote MCP deployment and again at 2026-05-04T21:05:37Z
# openclaw-railway-template deployment 44b4da3f-da1e-46b0-b640-d4e42ba731d8 SUCCESS
# current_token_mismatch_lines=0
# current_sessions_store_lines=0
# current_rate_limit_lines=0
```

```bash
npm run verify:gbrain -- --dead-jobs-readonly
# checked at 2026-05-04T21:03:12Z
# latest dead jobs remain historical: 1781, 1773, 1764, 1747, 1478
# no new dead shell job appeared after the scheduler patch so far
```

```bash
railway up --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 \
  --detach \
  --message "harden gbrain scheduler and readiness checks"
# deployment 4d70fc17-3642-47f4-bc88-92855c76c063
```

```bash
node /data/.openclaw/cron/bin/direct-minions-scheduler.mjs --validate
# total=19, cron=19, enabled_cron=12, disabled_cron=7
# disabled: email-to-brain-enrichment, astack-morning-briefing, astack-heartbeat,
# gbrain-brain-quality-steward, gbrain-enrichment-sweep,
# brain-steward-morning-briefing, brain-steward-collector-audit
```

```bash
tail -80 /data/.openclaw/cron/direct-minions/logs/scheduler.log
# skip_disabled_startup for all 7 disabled OpenClaw-agent wrapper jobs
# scheduler_started jobs=12 disabled=7
```

```bash
npm run check:gbrain-upstream -- --json
# checked at 2026-05-04T21:34:32Z
# status=WARN
# upstream sha/package: 058fe695756ed16e43916d907af3845338430156 / 0.26.7
# docker/verifier pins: 9e2093fc9bb6cb46520e58b0c95b807e788d9606 / 0.26.6 lineage
# runtime version 0.26.6
# warning: runtime checkout SHA f79cad0d... and runtime version 0.26.6 differ from upstream
# warning: local checkout /Users/arshya/gbrain is dirty on codex-gbrain-0.26.6-runtime-patches
```

```bash
npm run upgrade:gbrain-runtime -- --json
# plan only; no runtime mutation
# checked at 2026-05-04T21:30:52Z
# target service=openclaw-railway-template (6f333a2b-07d9-4219-8531-3b96fbc6a2f9)
# current runtime=gbrain 0.26.6 at f79cad0d45147b35d429ce94e6c81be3716d552e
# target upstream=058fe695756ed16e43916d907af3845338430156
# execute requires:
# GBRAIN_RUNTIME_UPGRADE_APPROVED=openclaw-gbrain-runtime-upgrade \
#   npm run upgrade:gbrain-runtime -- --execute --json
```

```bash
npm run upgrade:gbrain-runtime -- --execute --json
# checked at 2026-05-04T21:31:00Z
# status=BLOCKED_APPROVAL_REQUIRED
# no runtime mutation without GBRAIN_RUNTIME_UPGRADE_APPROVED=openclaw-gbrain-runtime-upgrade
```

```bash
npm run canary:gbrain
# status=PASS
# pages, tags, links/backlinks/graph, timeline, raw data, chunks, search/query,
# versions, delete/restore, jobs, embeddings, stats, and health checks passed
```

```bash
npm run verify:gbrain -- --runtime-readonly
# OpenClaw 2026.5.2, GBrain 0.26.6
# gbrain supervisor running, crashes_24h=0
# queue health: 0 waiting, 0 active, 0 stalled
# direct-minions scheduler validate: enabled_cron=12, disabled_cron=7
# enabled_agent_wrapper_count=0
```

```bash
sleep 1320 && npm run verify:gbrain -- --dead-jobs-readonly && \
  GBRAIN_VERIFY_SINCE=30m npm run verify:gbrain -- --railway-current
# completed at 2026-05-04T20:04:26Z
# latest dead jobs remain historical: 1781, 1773, 1764, 1747, 1478
# no new dead shell job appeared after the scheduler patch and critical slot
# deployment 4d70fc17-3642-47f4-bc88-92855c76c063 SUCCESS
# current_total_lines=0
# current_token_mismatch_lines=0
# current_sessions_store_lines=0
# current_rate_limit_lines=0
```

```bash
date -u '+%Y-%m-%dT%H:%M:%SZ' && \
  GBRAIN_VERIFY_SINCE=60m npm run verify:gbrain -- --railway-current && \
  npm run verify:gbrain -- --dead-jobs-readonly
# checked at 2026-05-04T20:27:19Z
# deployment 44b4da3f-da1e-46b0-b640-d4e42ba731d8 SUCCESS
# current_token_mismatch_lines=0
# current_sessions_store_lines=0
# current_rate_limit_lines=0
# latest dead jobs remain historical: 1781, 1773, 1764, 1747, 1478
```

```bash
date -u '+%Y-%m-%dT%H:%M:%SZ' && \
  GBRAIN_VERIFY_SINCE=120m npm run verify:gbrain -- --railway-current && \
  npm run verify:gbrain -- --dead-jobs-readonly
# checked at 2026-05-04T20:40:04Z
# deployment 44b4da3f-da1e-46b0-b640-d4e42ba731d8 SUCCESS
# current_token_mismatch_lines=0
# current_sessions_store_lines=0
# current_rate_limit_lines=0
# latest dead jobs remain historical: 1781, 1773, 1764, 1747, 1478
```

```bash
/Users/arshya/.oracle/bin/oracle-pro review ... --run --json
# status=ok
# recommendationSummary=Keep PASS_WITH_CONCERNS
# blockerCount=5, nonBlockerCount=5
# key blocker fixed in this sprint: openclaw-agent-job.sh exit-status preservation
```

```bash
/Users/arshya/.oracle/bin/oracle-pro review \
  --slug gbrain-astack-full-pass-remote-mcp-final \
  --risk release \
  --intent release_gate \
  --run --json
# status=ok
# recommendationSummary=Keep PASS_WITH_CONCERNS
# blockerCount=5, nonBlockerCount=5
# Remote MCP can now be counted as live-pass for the AStack-owned
# Railway deployment/canary layer, but not as upstream-clean until #620 lands.
# Remaining blockers: Claude quota, 24-48h scheduler burn-in, PR #619,
# PR #620, and approval-gated 0.26.7+ upgrade.
```

```bash
rg -n "gbrain_(?:cs|at|rt|code)_[A-Za-z0-9_-]+|postgres(?:ql)?://|sk-[A-Za-z0-9_-]+" \
  docs/gbrain-full-pass-readiness-sprint-2026-05-04.md \
  services/gbrain-remote-mcp scripts/gbrain-remote-mcp-canary.mjs
# no committed secret matches in report or remote MCP files
```

```bash
railway up --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 \
  --detach \
  --message "fix openclaw agent job fallback status"
# deployment 44b4da3f-da1e-46b0-b640-d4e42ba731d8
# final status SUCCESS, stopped=false
```

```bash
grep -n "fallback_err_file\\|OPENCLAW_AGENT_JOB_DATA_HOME\\|fallback_status\\|openai/gpt-5.4" \
  /data/.openclaw/cron/bin/openclaw-agent-job.sh
# runtime wrapper contains OPENCLAW_AGENT_JOB_DATA_HOME, fallback_err_file,
# fallback_status, and default openai/gpt-5.4
```

```bash
# upstream GBrain worktree: /tmp/gbrain-resolver-routing-fix
bun run src/cli.ts doctor --fast --json | jq '.checks[] | select(.name=="resolver_health")'
# resolver_health status=ok, message="39 skills, all reachable"

bun run src/cli.ts routing-eval --skills-dir skills --json
# ok=true, totalCases=58, passed=58, missed=0, ambiguous=0, falsePositives=0

HOME=$(mktemp -d /tmp/gbrain-test-home.XXXXXX) \
  env -u OPENCLAW_WORKSPACE -u OPENCLAW_HOME -u GBRAIN_SKILLS_DIR \
  bun test test/resolver.test.ts test/routing-eval.test.ts \
    test/check-resolvable.test.ts test/check-resolvable-cli.test.ts
# 161 pass, 0 fail

gh pr view 619 --repo garrytan/gbrain --json number,title,state,url
# #619 fix: align resolver routing fixtures [OPEN, MERGEABLE]

gh pr comment 619 --repo garrytan/gbrain --body "<resolver readiness evidence>"
# https://github.com/garrytan/gbrain/pull/619#issuecomment-4374657081
# posted doctor/routing-eval/isolated test evidence and downstream readiness impact
```

```bash
# upstream GBrain worktree: /tmp/gbrain-http-auth-fix
bun run typecheck
# pass

bun test test/oauth.test.ts
# 42 pass, 0 fail

bun test test/e2e/serve-http-oauth.test.ts
# skipped without DATABASE_URL; no live DB mutation during this verification

gh pr view 620 --repo garrytan/gbrain --json number,title,state,url
# #620 fix: return clean auth failures for invalid MCP bearer tokens [OPEN, MERGEABLE]

gh pr comment 620 --repo garrytan/gbrain --body "<remote MCP auth readiness evidence>"
# https://github.com/garrytan/gbrain/pull/620#issuecomment-4374658198
# posted typecheck/oauth-test/live remote MCP canary evidence and downstream readiness impact
```

```bash
codex mcp list
# gbrain: /Users/arshya/.bun/bin/gbrain serve - enabled

npm run canary:gbrain-codex
# checked at 2026-05-04T22:14:57Z through the full-pass gate runner
# status=PASS
# health_seen=true, search_seen=true, sentinel_seen=true, delete_restore_seen=true
# proves local Codex can use the same shared GBrain via MCP, not only list it
# note: the required sentinel is verified after restore; the pre-delete
# get_page can be cancelled by Codex noninteractive safety without blocking
# the canary because post-restore get_page proves write + restore.
# note: script uses two Codex exec phases so unrelated remote MCP OAuth failures
# do not make health/search/write flaky while delete/restore still uses
# the real local Codex policy.
```

```bash
gbrain --version
# gbrain 0.26.6

gbrain doctor --json | jq '{status, health_score, warnings, errors}'
# status=warnings, health_score=95
# warning: resolver_health "Could not find skills directory"
# errors=[]

gbrain search "gbrain openclaw readiness" --limit 3 --json
# search returns relevant AStack/GBrain context; command exits 0
# note: local CLI emitted human-formatted rows despite --json on 0.26.6
```

```bash
claude mcp list
# gbrain: /Users/arshya/.bun/bin/gbrain serve - connected
```

```bash
claude --print --output-format json --permission-mode bypassPermissions \
  --allowedTools mcp__gbrain__get_page -- "<gbrain get_page canary>"
# checked at 2026-05-04T23:04:53+02:00
# blocked: You've hit your limit - resets 2am (Europe/Zurich)
```

```bash
npm run canary:gbrain-claude
# checked at 2026-05-04T23:07:38+02:00
# status=BLOCKED_QUOTA
# claude_exit_code=1
# api_error_status=429
# message="You've hit your limit · resets 2am (Europe/Zurich)"
```

```bash
npm run verify:gbrain-full-pass-gates -- --skip-claude --json
# checked at 2026-05-04T22:14:57Z
# status=BLOCKED
# PASS: openclaw_runtime_risk_logs
# PASS: codex_shared_gbrain_canary
# BLOCKED: upstream_pr_619_resolver open/mergeable
# BLOCKED: upstream_pr_620_http_auth open/mergeable
# BLOCKED: update_flow_currentness runtime/pins behind upstream 0.26.7
# BLOCKED: scheduler_dead_jobs_burn_in 2.1h/24h complete, no new dead jobs so far
# Claude gate evaluated separately with npm run canary:gbrain-claude:
# BLOCKED_QUOTA until 2am Europe/Zurich
```

## Rollback

OpenClaw target rollback:

1. Roll Railway service `openclaw-railway-template` back from `44b4da3f-da1e-46b0-b640-d4e42ba731d8` to the previous known-good deployment `4d70fc17-3642-47f4-bc88-92855c76c063`.
2. If a full scheduler revert is needed, roll further back to `8f4b1abf-15d0-4052-87e2-348e1555d282`.
3. Or restore the runtime backups created by `start-astack.sh` under:
   - `/data/.openclaw/cron/bin/direct-minions-scheduler.mjs.bak.astack-*`
   - `/data/.openclaw/cron/bin/openclaw-agent-job.sh.bak.astack-*`

Remote MCP rollback:

- Roll Railway service `gbrain-remote-mcp` back from `20fbbae5-5abd-47d5-b95a-7745a14769e6` to previous known-good deployment `1d3d944a-23ee-4914-807e-ac65908b8f4b`.
- If remote MCP exposure must be stopped immediately, pause/remove only `gbrain-remote-mcp`; do not roll back the whole Railway project and do not touch `openclaw-railway-template`.

## Remaining FULL PASS Gates

1. Re-run Claude Code real MCP canary after quota reset.
2. Observe 24-48h that no new dead shell jobs are created from disabled OpenClaw-agent wrapper jobs or model cooldown.
3. Land or consume upstream GBrain PR #619 so runtime doctor can move from shipped resolver warnings to `ok`.
4. Decide and run the approval-gated GBrain upgrade path from runtime `0.26.6` to latest safe upstream `0.26.7+` after backup, migrations, full doctor, and direct/OpenClaw/remote/local canaries.
5. Land or consume upstream GBrain PR #620 so invalid/expired MCP bearer tokens return clean OAuth auth failures from upstream, not only from the astack wrapper; until then, status remains `PASS_WITH_CONCERNS`, not FULL PASS.
