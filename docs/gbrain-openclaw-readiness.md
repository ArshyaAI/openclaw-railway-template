# GBrain / OpenClaw Readiness Runbook

Status: `PASS_WITH_CONCERNS`
Date: 2026-05-03
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
| OpenClaw agent canary | Final run `926ca872-5d8c-4803-aa13-d2d8bab5f42c`, `status=ok`, used `gbrain__query`, `gbrain__search`, and `gbrain__list_pages` with no fallback | `PASS` |
| Runtime logs | Last 10m after final canary: `current_total_lines=2`, `token_mismatch=0`, `sessions_store=0`, `rate_limit=0` | `PASS` |
| Dirty/untracked Markdown sync | Synthetic allowlisted source indexed dirty tracked and untracked Markdown without false `up_to_date` | `PASS` |
| Direct-minions scheduler | Process `236 node /data/.openclaw/cron/bin/direct-minions-scheduler.mjs`; active OpenClaw agent wrappers `0`; direct GBrain shell jobs `11`; queue `0 waiting, 0 active, 0 stalled` | `PASS` |

## Known Concerns

- Upstream GBrain still ships `openclaw.plugin.json`; OpenClaw `2026.5.2`
  `plugins install /data/gbrain --link` rejected it because current OpenClaw
  expects `package.json` `openclaw.extensions`. Runtime MCP is therefore
  configured directly with `openclaw mcp set gbrain`, not via plugin install.
- `gbrain doctor --json` still warns on resolver routing fixtures and
  `frontmatter_integrity` (`4129` issues across `21` sources). DB, schema,
  embeddings, JSONB, markdown body completeness, and queue health are ok.
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
- Oracle Pro final gate agreed that `PASS_WITH_CONCERNS` is defensible for this
  target, but rejected any claim of perfect/full-feature readiness until doctor
  warnings, upstream plugin packaging, restart/soak proof, and broader MCP tool
  coverage are addressed or waived.

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

- Previous stable deployment: `a55d9794-0ecb-4ff9-8bd4-ce9462381c41`

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
