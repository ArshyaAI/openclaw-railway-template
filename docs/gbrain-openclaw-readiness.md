# GBrain / OpenClaw Readiness Runbook

Status: `PASS_WITH_CONCERNS`
Date: 2026-05-04
Scope: core dogfood readiness for this target service, not perfect/full-feature
readiness.

This runbook captures the current production-target state for the approved
OpenClaw/GBrain dogfood service. It is deliberately scoped to the target
Railway service below and must not be reused for the NIKIN main production
service.

## Target

- Project: `ravishing-enjoyment`
- Project ID: `fbdb217b-060f-4f1e-8697-08a6288a19c4`
- Environment: `production`
- Environment ID: `614198f2-f7ed-4756-ae83-e0dd23943c9d`
- Service: `openclaw-railway-template`
- Service ID: `6f333a2b-07d9-4219-8531-3b96fbc6a2f9`
- Current deployment: `534de0ca-dd28-4127-b521-f8c8413c6e43`

Forbidden non-target service:

- `NIKIN - MAIN OC INSTANCE [PRODUCTION]`
- Service ID: `63b84308-25d7-4b03-9c23-4d0d7239728f`

## Current State

| Area | Evidence | Status |
| --- | --- | --- |
| OpenClaw runtime | `OpenClaw 2026.5.2 (8b2a6e5)` | `PASS` |
| AlphaClaw runtime | `@chrysb/alphaclaw 0.9.12` | `PASS` |
| GBrain runtime | `gbrain 0.26.0`, checkout `254609fdb9ace13b4147cdf4c5ef56460ec51dd9` | `PASS_WITH_LATEST_CONCERN` |
| Upstream source | `https://github.com/garrytan/gbrain`, latest checked `master` now `9e2093fc9bb6cb46520e58b0c95b807e788d9606` / `0.26.6`; runtime was built from previous upstream `d01a921e01243c326e2508c7d21eb85095f1fbe8` plus patches | `BLOCKS_FULL_COMPLETION` |
| GBrain schema | Schema `33`, latest `33` | `PASS` |
| GBrain supervisor | Running from boot, PID `81`, `crashes_24h=0` | `PASS` |
| Full doctor | `status=warnings`, `health_score=90`, DB/pgvector/RLS/schema/embeddings/jsonb/body/queue ok | `PASS_WITH_WARNINGS` |
| OpenClaw MCP config | `gbrain` stdio MCP configured via `/data/.bun/bin/gbrain serve` | `PASS` |
| Boot MCP persistence | Deployment `534de0ca-dd28-4127-b521-f8c8413c6e43`; runtime `alphaclaw.js` contains `codexEnsureGbrainMcpBootConfig`; fresh Gateway loaded `gbrain__*` tools without manual repair | `PASS` |
| MCP smoke | Client listed `41` tools, including `search`, `query`, `get_page` | `PASS` |
| OpenClaw agent canary | Fresh post-deploy run `443741c2-6ba3-4ef0-a9d1-8be70a0d62c9`, `status=ok`, used `gbrain__query`, failures `0`, no shell fallback | `PASS` |
| Broad MCP canary | Run `b8e37a51-2e74-408a-8562-05be43d695fc`, `status=ok`, used `gbrain__get_health`, `gbrain__get_stats`, `gbrain__search`, `gbrain__get_page`, `gbrain__get_links`, `gbrain__get_backlinks`, and `gbrain__get_tags`; failures `0` | `PASS` |
| Full feature coverage | Runtime discovers `41` GBrain tools; only read/query/health/stats/graph-read/tag-read/list/sync paths are exercised. Mutating, file, raw-data, versioning, ingest-log, resolver/chunk/orphan, timeline traversal, and job-control tools still need a controlled canary | `BLOCKS_FULL_COMPLETION` |
| Runtime logs | Latest checks: 30m window saw one isolated 4-line `token_mismatch` burst at `2026-05-04T05:30:31Z`; follow-up 1m window was clean with `token_mismatch=0`, `sessions_store=0`, `rate_limit=0` | `PASS_WITH_NOTE` |
| Dirty/untracked Markdown sync | Synthetic allowlisted source indexed dirty tracked and untracked Markdown without false `up_to_date` | `PASS` |
| Direct-minions scheduler | Process `265 node /data/.openclaw/cron/bin/direct-minions-scheduler.mjs`; active OpenClaw agent wrappers `0`; direct GBrain shell jobs remain enabled; queue `0 waiting, 0 active, 0 stalled` | `PASS` |

## Known Concerns

- Upstream GBrain still ships `openclaw.plugin.json`; OpenClaw `2026.5.2`
  `plugins install /data/gbrain --link` rejected it because current OpenClaw
  expects `package.json` `openclaw.extensions`. Runtime MCP is therefore
  configured directly with `openclaw mcp set gbrain`, not via plugin install.
- Upstream GBrain has advanced past the runtime pin. Latest checked upstream
  `master` is `9e2093fc9bb6cb46520e58b0c95b807e788d9606` / `0.26.6`.
  Runtime remains `0.26.0` / schema `33`; upstream `0.26.5` adds destructive
  operation guards and schema `34`, and `0.26.6` adds PGLite/Postgres parity
  gating. This blocks any "latest-safe" or full completion claim.
- `gbrain doctor --json` still warns on resolver routing fixtures and
  `frontmatter_integrity` (`4129` issues across `21` sources). DB, schema,
  embeddings, JSONB, markdown body completeness, and queue health are ok.
- A follow-up runtime log check found one isolated four-line
  `token_mismatch` burst at `2026-05-04T05:30:31Z`; a later 1-minute window was
  clean. Treat as a watch item, not an active session-store loop.
- Boot persistence is now proven by deployment `534de0ca-dd28-4127-b521-f8c8413c6e43`.
  The template patches AlphaClaw after its remote config restore and before
  Gateway launch so the Gateway starts with `mcp.servers.gbrain` already in
  memory. Earlier post-boot-only repair was insufficient because the Gateway
  had already materialized its MCP catalog.
- Seven direct-minions jobs that called
  `gbrain-submit-openclaw-agent-job.sh` were disabled in runtime state to stop
  scheduled OpenClaw agent-wrapper quota exposure. Backup:
  `/data/.openclaw/cron/direct-minions/jobs.json.bak.disable-agent-wrappers-20260503T174921Z`.
  The direct GBrain shell jobs remain enabled. Historical dead jobs still show
  earlier `openai-codex/gpt-5.5` cooldown / ChatGPT usage-limit failures.
- Stale `plugins.entries.device-pair` warning noise was removed from the
  runtime OpenClaw config. Backup:
  `/data/.openclaw/openclaw.json.bak.remove-device-pair-20260503T175758Z`.
- Local workstation `gbrain` now reports `gbrain 0.26.0` from
  `/Users/arshya/gbrain` at upstream
  `d01a921e01243c326e2508c7d21eb85095f1fbe8`. Local doctor is still not the
  authority for the Railway target because the local supervisor is intentionally
  not running.
- Final Oracle Pro gate on `2026-05-04` returned
  `BLOCKED_FOR_GOAL_COMPLETION / PASS_WITH_CONCERNS_FOR_CORE_DOGFOOD`.
  It explicitly rejected closing the `/goal` because the runtime is behind
  upstream `0.26.6`, not all `41` GBrain tools/features are live-exercised, the
  plugin install path is bypassed, doctor warnings remain, and HTTP/OAuth/Admin
  surfaces are not proven live.

## Safe Verification Commands

Run from `/Users/arshya/Desktop/AI.nosync/openclaw-railway-template`:

```bash
npm run verify:gbrain -- --help
npm run verify:gbrain -- --local
npm run verify:gbrain -- --runtime-readonly
GBRAIN_VERIFY_SINCE=10m npm run verify:gbrain -- --railway-current
npm run verify:gbrain -- --gbrain-install-readonly
npm run verify:gbrain -- --dead-jobs-readonly
```

Direct runtime smoke checks:

```bash
railway ssh --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 \
  "env HOME=/data GBRAIN_HOME=/data BRAIN_REPO=/data/brain BUN_INSTALL=/data/.bun PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /data/.bun/bin/gbrain query astack --limit 5 --expand false --detail high"

railway ssh --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 \
  "env HOME=/data GBRAIN_HOME=/data BRAIN_REPO=/data/brain BUN_INSTALL=/data/.bun PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /app/node_modules/.bin/openclaw mcp list"
```

Check that no enabled direct-minions job still launches an OpenClaw agent
wrapper:

```bash
railway ssh --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 \
  "env HOME=/data GBRAIN_HOME=/data BRAIN_REPO=/data/brain BUN_INSTALL=/data/.bun PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin node -e 'const fs=require(\"fs\"); const root=JSON.parse(fs.readFileSync(\"/data/.openclaw/cron/direct-minions/jobs.json\",\"utf8\")); const jobs=Array.isArray(root)?root:root.jobs; const active=jobs.filter(j=>j.enabled!==false && String(j.command||\"\").includes(\"gbrain-submit-openclaw-agent-job.sh\")); console.log(JSON.stringify({active_agent_wrappers:active.map(j=>j.name),active_count:active.length},null,2));'"
```

## Rollback Notes

Runtime deployment rollback target:

- Previous boot-patch predecessor: `d08dcecb-c0a2-496e-814b-50e37b050262`
- Pre-upgrade stable deployment: `a55d9794-0ecb-4ff9-8bd4-ce9462381c41`

GBrain runtime backups:

- `/data/.gbrain-upgrade-backups/20260503T165639Z-1854eef0373340394ae8d784b533810b75243a73`
- `/data/.gbrain-upgrade-backups/20260503T170450Z-activate-1854eef0373340394ae8d784b533810b75243a73`
- `/data/.gbrain-upgrade-backups/wrapper-home-fix-20260503T171152Z`

OpenClaw config backups created during MCP work:

- `/data/.openclaw/openclaw.json.bak.codex-gbrain-mcp-20260503T173756Z`
- `/data/.openclaw/openclaw.json.bak.codex-gbrain-plugin-20260503T173655Z`
- `/data/.openclaw/openclaw.json.bak.codex-gbrain-plugin-20260503T173644Z`
- `/data/.openclaw/openclaw.json.bak.remove-device-pair-20260503T175758Z`

Direct-minions jobs backup before disabling scheduled OpenClaw agent wrappers:

- `/data/.openclaw/cron/direct-minions/jobs.json.bak.disable-agent-wrappers-20260503T174921Z`

To remove only the direct GBrain MCP entry:

```bash
railway ssh --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 \
  "env HOME=/data PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin /app/node_modules/.bin/openclaw mcp unset gbrain"
```

## Operating Notes

- Treat `/data/gbrain` as the GBrain tool repo.
- Treat `/data/brain`, `/data/sources`, and the Postgres database as content
  brain state.
- Treat `/Users/arshya/Desktop/AI.nosync/openclaw-railway-template` as the
  deployable runtime template repo.
- Treat `/Users/arshya/Desktop/AI.nosync/astack` as the local evidence/report
  workspace, not the runtime repo.
- Keep the seven disabled OpenClaw agent-wrapper direct-minions jobs disabled
  until there is a written quota/session-churn guardrail and explicit approval
  to re-enable them.
- Do not expose remote HTTP MCP, OAuth clients, tunnels, webhooks, or new cron
  entries without a new written guardrail pass.
