# GBrain Full-Pass Readiness Sprint - 2026-05-04

Status: `PASS_WITH_CONCERNS`

This is the astack-owned follow-up sprint for the remaining GBrain full-pass blockers. It continues from `docs/gbrain-resume-readiness-2026-05-04.md` and does not reset the earlier evidence.

## Scope

- OpenClaw target service: `openclaw-railway-template` (`6f333a2b-07d9-4219-8531-3b96fbc6a2f9`)
- Railway project/env: `ravishing-enjoyment` / `production`
- Forbidden service: `NIKIN - MAIN OC INSTANCE [PRODUCTION]` (`63b84308-25d7-4b03-9c23-4d0d7239728f`)
- Remote MCP service code: `services/gbrain-remote-mcp/`
- GBrain upstream: `https://github.com/garrytan/gbrain`

No command in this sprint inspected or mutated the forbidden service.

## Hunt-First Diagnosis

| Bucket | Finding |
| --- | --- |
| Already working | OpenClaw target service healthy, GBrain `0.26.6`, stdio MCP configured, supervisor running, direct GBrain canaries previously passed, local Codex MCP present. |
| Working but not FULL PASS | Remote MCP is fail-closed, but live bad bearer token still returns `500`; doctor remains `warnings`; scheduled shell-job health needs observation. |
| Missing evidence | Claude Code real toolcall is still blocked by Claude quota; remote expired-token/revoked-client/log-redaction negative canaries need live credentials/log sample. |
| Real blockers | Running direct-minions scheduler ignored `enabled:false`; this produced fresh dead shell jobs from disabled OpenClaw-agent wrapper jobs. |
| Security risks | Remote MCP must return clean auth status, keep DCR disabled, keep CORS default-deny, and avoid auth material in logs. |
| Not worth doing now | Custom MCP gateway, broad project rollback, re-enabling OpenClaw-agent scheduled wrappers without quota policy. |

## Workstream Status

| Workstream | Status | Evidence |
| --- | --- | --- |
| 1. Remote MCP hardening | code-ready, live remote deploy blocked by target scope | Wrapper patch now maps `/mcp` auth failures to `401/403`, wraps the async `/mcp` handler with `try/catch next(err)`, and canary now hard-fails if bad token returns non-401/403. Current live remote still fails with `bad_token expected clean 401/403 auth failure, got 500`. Upstream issue: <https://github.com/garrytan/gbrain/issues/616>. Upstream fix PR: <https://github.com/garrytan/gbrain/pull/620>. |
| 2. Scheduler/quota fix | live patch deployed, post-slot clean, 24-48h monitoring pending | Deployment `44b4da3f-da1e-46b0-b640-d4e42ba731d8` installed the corrected astack-owned scheduler/wrapper. Runtime validate: `enabled_cron=12`, `disabled_cron=7`; scheduler startup logged `skip_disabled_startup` for all 7 disabled OpenClaw-agent wrapper jobs. A post-critical-slot watch at `2026-05-04T20:04:26Z` found no new dead shell jobs after historical job `1781`; fresh logs had 0 token mismatch, 0 session-store churn, and 0 rate-limit lines. `openclaw-agent-job.sh` now defaults to `openai/gpt-5.4` if intentionally enabled and preserves failure exit codes across no-fallback, fallback-success, and fallback-fail paths. |
| 3. Claude Code canary | blocked | `claude mcp list` shows `gbrain` connected, but `claude --print ... mcp__gbrain__get_page` returned `You've hit your limit - resets 2am (Europe/Zurich)`. |
| 4. Doctor warnings upstream route | upstream PR open | Runtime doctor still warns on 37 shipped skill routing misses while pinned to GBrain `0.26.6`. Upstream issue: <https://github.com/garrytan/gbrain/issues/617>. Fix PR: <https://github.com/garrytan/gbrain/pull/619>. In the upstream worktree, the PR makes `resolver_health` `ok` and `routing-eval` 58/58. |
| 5. Update flow automation | pass with version drift concern | Added `npm run check:gbrain-upstream`. It checks upstream SHA/package version, Docker/verifier pins, local checkout, and runtime SHA/version. Current output warns because upstream master is now `058fe695756ed16e43916d907af3845338430156` / `0.26.7`, while Docker/verifier pins remain `9e2093fc9bb6cb46520e58b0c95b807e788d9606` and runtime remains GBrain `0.26.6`. Upgrade remains approval-gated. |
| 6. Remote MCP product interface | partial | astack keeps upstream `gbrain serve --http` wrapper and has canaries/docs/rollback. Live remote service hardening deploy needs explicit scope expansion because this sprint's safety target was only `openclaw-railway-template`. |

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
- Expanded `scripts/gbrain-remote-mcp-canary.mjs`.
  - Missing token, bad token, DCR disabled, CORS default-deny, admin-route denial, read-only write denial.
  - Optional env-backed checks for expired token, revoked client, and log redaction sample.
- Added `scripts/check-gbrain-upstream.mjs` and npm script `check:gbrain-upstream`.
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
node --check patches/direct-minions-scheduler.mjs
bash -n patches/start-astack.sh
bash -n patches/openclaw-agent-job.sh
bash -n scripts/verify-gbrain-openclaw-readiness.sh
npm run test:openclaw-agent-job
```

```bash
GBRAIN_REMOTE_MCP_URL=https://gbrain-remote-mcp-production.up.railway.app npm run canary:gbrain-remote
# FAIL: bad_token expected clean 401/403 auth failure, got 500
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
# status=WARN
# upstream sha/package: 058fe695756ed16e43916d907af3845338430156 / 0.26.7
# docker/verifier pins: 9e2093fc9bb6cb46520e58b0c95b807e788d9606 / 0.26.6 lineage
# runtime version 0.26.6
# warning: runtime checkout SHA f79cad0d... and runtime version 0.26.6 differ from upstream
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
# #619 fix: align resolver routing fixtures [OPEN]
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
# #620 fix: return clean auth failures for invalid MCP bearer tokens [OPEN]
```

```bash
claude mcp list
# gbrain: /Users/arshya/.bun/bin/gbrain serve - connected
```

```bash
claude --print --output-format json --permission-mode bypassPermissions \
  --allowedTools mcp__gbrain__get_page -- "<gbrain get_page canary>"
# blocked: You've hit your limit - resets 2am (Europe/Zurich)
```

## Rollback

OpenClaw target rollback:

1. Roll Railway service `openclaw-railway-template` back from `44b4da3f-da1e-46b0-b640-d4e42ba731d8` to the previous known-good deployment `4d70fc17-3642-47f4-bc88-92855c76c063`.
2. If a full scheduler revert is needed, roll further back to `8f4b1abf-15d0-4052-87e2-348e1555d282`.
3. Or restore the runtime backups created by `start-astack.sh` under:
   - `/data/.openclaw/cron/bin/direct-minions-scheduler.mjs.bak.astack-*`
   - `/data/.openclaw/cron/bin/openclaw-agent-job.sh.bak.astack-*`

Remote MCP rollback:

- No remote MCP runtime deploy was made in this sprint.
- If the remote service is later deployed and needs rollback, pause/remove only `gbrain-remote-mcp`; do not roll back the whole Railway project.

## Remaining FULL PASS Gates

1. Deploy Remote MCP hardening to the `gbrain-remote-mcp` service, after explicitly expanding the allowed target scope beyond `openclaw-railway-template`.
2. Re-run remote MCP canary with a valid OAuth client and optional negative-test fixtures for expired token, revoked client, and log sample.
3. Re-run Claude Code real MCP canary after quota reset.
4. Observe 24-48h that no new dead shell jobs are created from disabled OpenClaw-agent wrapper jobs or model cooldown.
5. Land or consume upstream GBrain PR #619 so runtime doctor can move from shipped resolver warnings to `ok`.
6. Decide and run the approval-gated GBrain upgrade path from runtime `0.26.6` to latest safe upstream `0.26.7+` after backup, migrations, full doctor, and direct/OpenClaw/remote/local canaries.
7. Land or consume upstream GBrain PR #620 so invalid/expired MCP bearer tokens return clean OAuth auth failures from upstream, not only from the astack wrapper; until then, status remains `PASS_WITH_CONCERNS`, not FULL PASS.
