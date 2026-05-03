# GBrain / OpenClaw Readiness Runbook

Status: `PASS_WITH_CONCERNS`
Date: 2026-05-03

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
- Current deployment: `4dd37433-58ce-46b6-b8f7-36aa8fd54480`

Forbidden non-target service:

- `NIKIN - MAIN OC INSTANCE [PRODUCTION]`
- Service ID: `63b84308-25d7-4b03-9c23-4d0d7239728f`

## Current State

| Area | Evidence | Status |
| --- | --- | --- |
| OpenClaw runtime | `OpenClaw 2026.5.2 (8b2a6e5)` | `PASS` |
| AlphaClaw runtime | `@chrysb/alphaclaw 0.9.12` | `PASS` |
| GBrain runtime | `gbrain 0.26.0`, checkout `254609fdb9ace13b4147cdf4c5ef56460ec51dd9` | `PASS` |
| Upstream source | `https://github.com/garrytan/gbrain`, inspected at `d01a921e01243c326e2508c7d21eb85095f1fbe8` | `PASS` |
| GBrain schema | Schema `33`, latest `33` | `PASS` |
| GBrain supervisor | Running from boot, PID `81`, `crashes_24h=0` | `PASS` |
| Full doctor | `status=warnings`, `health_score=90`, DB/pgvector/RLS/schema/embeddings/jsonb/body/queue ok | `PASS_WITH_WARNINGS` |
| OpenClaw MCP config | `gbrain` stdio MCP configured via `/data/.bun/bin/gbrain serve` | `PASS` |
| MCP smoke | Client listed `41` tools, including `search`, `query`, `get_page` | `PASS` |
| OpenClaw agent canary | Run `218ba6bd-8da9-47c3-a6f1-d0866ed7b338`, `status=ok`, used `gbrain__query` and `gbrain__search` | `PASS` |
| Runtime logs | Last 10m after canary: `token_mismatch=0`, `sessions_store=0`, `rate_limit=0` | `PASS` |
| Dirty/untracked Markdown sync | Synthetic allowlisted source indexed dirty tracked and untracked Markdown without false `up_to_date` | `PASS` |
| Direct-minions scheduler | Process `236 node /data/.openclaw/cron/bin/direct-minions-scheduler.mjs`; GBrain queue `0 waiting, 0 active, 0 stalled` | `PASS_WITH_CONCERNS` |

## Known Concerns

- Upstream GBrain still ships `openclaw.plugin.json`; OpenClaw `2026.5.2`
  `plugins install /data/gbrain --link` rejected it because current OpenClaw
  expects `package.json` `openclaw.extensions`. Runtime MCP is therefore
  configured directly with `openclaw mcp set gbrain`, not via plugin install.
- `gbrain doctor --json` still warns on resolver routing fixtures and
  `frontmatter_integrity` (`4129` issues across `21` sources). DB, schema,
  embeddings, JSONB, markdown body completeness, and queue health are ok.
- Some enabled direct-minions jobs intentionally call
  `gbrain-submit-openclaw-agent-job.sh`; recent dead jobs were caused by
  earlier `openai-codex/gpt-5.5` cooldown / ChatGPT usage-limit failures.
  Current post-canary logs are clean, but these jobs can still consume model
  quota.
- `plugins.entries.device-pair` remains present while that bundled plugin is
  disabled by default, producing a noisy OpenClaw config warning.
- Local workstation `gbrain` is still older than the runtime. Use the runtime
  binary for target verification until local GBrain is upgraded separately.

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

## Rollback Notes

Runtime deployment rollback target:

- Previous stable deployment: `a55d9794-0ecb-4ff9-8bd4-ce9462381c41`

GBrain runtime backups:

- `/data/.gbrain-upgrade-backups/20260503T165639Z-1854eef0373340394ae8d784b533810b75243a73`
- `/data/.gbrain-upgrade-backups/20260503T170450Z-activate-1854eef0373340394ae8d784b533810b75243a73`
- `/data/.gbrain-upgrade-backups/wrapper-home-fix-20260503T171152Z`

OpenClaw config backups created during MCP work:

- `/data/.openclaw/openclaw.json.bak.codex-gbrain-mcp-20260503T173756Z`
- `/data/.openclaw/openclaw.json.bak.codex-gbrain-plugin-20260503T173655Z`
- `/data/.openclaw/openclaw.json.bak.codex-gbrain-plugin-20260503T173644Z`

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
- Do not expose remote HTTP MCP, OAuth clients, tunnels, webhooks, or new cron
  entries without a new written guardrail pass.
