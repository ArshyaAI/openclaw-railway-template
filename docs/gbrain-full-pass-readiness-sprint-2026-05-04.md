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
| 1. Remote MCP hardening | code-ready, live remote deploy blocked by target scope | Wrapper patch now maps `/mcp` auth failures to `401/403`; canary now hard-fails if bad token returns non-401/403. Current live remote still fails with `bad_token expected clean 401/403 auth failure, got 500`. Upstream issue: <https://github.com/garrytan/gbrain/issues/616>. |
| 2. Scheduler/quota fix | live patch deployed, monitoring pending | Deployment `4d70fc17-3642-47f4-bc88-92855c76c063` installed astack-owned scheduler. Runtime validate: `enabled_cron=12`, `disabled_cron=7`; scheduler startup logged `skip_disabled_startup` for all 7 disabled OpenClaw-agent wrapper jobs. `openclaw-agent-job.sh` now defaults to `openai/gpt-5.4` if intentionally enabled. |
| 3. Claude Code canary | blocked | `claude mcp list` shows `gbrain` connected, but `claude --print ... mcp__gbrain__get_page` returned `You've hit your limit - resets 2am (Europe/Zurich)`. |
| 4. Doctor warnings upstream route | upstream issue filed | Runtime doctor still warns on 37 shipped skill routing misses. Upstream issue: <https://github.com/garrytan/gbrain/issues/617>. |
| 5. Update flow automation | pass with runtime SHA concern | Added `npm run check:gbrain-upstream`. It checks upstream SHA/package version, Docker/verifier pins, local checkout, and runtime SHA/version. Current output warns because runtime checkout SHA is `f79cad0d...` while upstream master is `9e2093f...`, but package version is `0.26.6`. |
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
- Updated `patches/start-astack.sh`.
  - Installs the astack-owned direct-minions runtime scripts into `/data/.openclaw/cron/bin` at boot, backing up changed files first.
- Updated Remote MCP wrapper patch.
  - Adds a `/mcp` auth error handler that redacts auth failures and returns `401/403`.
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
# upstream sha/package: 9e2093fc9bb6cb46520e58b0c95b807e788d9606 / 0.26.6
# docker/verifier pins match upstream
# runtime version 0.26.6
# warning: runtime checkout SHA f79cad0d... differs from upstream 9e2093f...
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

1. Roll Railway service `openclaw-railway-template` back from `4d70fc17-3642-47f4-bc88-92855c76c063` to the previous known-good deployment `8f4b1abf-15d0-4052-87e2-348e1555d282`.
2. Or restore the runtime backups created by `start-astack.sh` under:
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
5. Wait for or contribute upstream fixes for GBrain issues #616 and #617; until then, status remains `PASS_WITH_CONCERNS`, not FULL PASS.
