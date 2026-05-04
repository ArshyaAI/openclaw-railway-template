# GBrain Readiness Report - 2026-05-04

Status: PASS_WITH_CONCERNS

Target:
- Railway project: ravishing-enjoyment (`fbdb217b-060f-4f1e-8697-08a6288a19c4`)
- Environment: production (`614198f2-f7ed-4756-ae83-e0dd23943c9d`)
- Service: openclaw-railway-template (`6f333a2b-07d9-4219-8531-3b96fbc6a2f9`)
- Forbidden service not touched: NIKIN - MAIN OC INSTANCE [PRODUCTION] (`63b84308-25d7-4b03-9c23-4d0d7239728f`)

## Version Matrix

| Area | Current | Decision |
| --- | --- | --- |
| GBrain upstream source | `https://github.com/garrytan/gbrain` | Source of truth |
| GBrain upstream master | `9e2093fc9bb6cb46520e58b0c95b807e788d9606` | Inspected and pinned |
| GBrain package | `0.26.6` | Current |
| Runtime GBrain checkout | `/data/gbrain`, head `f79cad0d45147b35d429ce94e6c81be3716d552e` | Upstream `0.26.6` plus runtime compatibility patches |
| Local GBrain patch branch | `/Users/arshya/gbrain`, `codex-gbrain-0.26.6-runtime-patches` | Contains runtime patches |
| AlphaClaw | `0.9.13` | Current npm latest |
| OpenClaw | `2026.5.2` | Pinned because AlphaClaw `0.9.13` declares `openclaw: 2026.5.2` |
| OpenClaw npm latest observed | `2026.5.3` | Not adopted until AlphaClaw declares compatibility |
| Runtime deploy | `8f4b1abf-15d0-4052-87e2-348e1555d282` | SUCCESS |

## Upstream / Update Notes

- `gbrain upgrade` exists and is the intended upstream self-update command.
- `gbrain check-update --json` exists and the runtime direct-minions schedule includes `gbrain-update-check`.
- Current runtime `gbrain check-update --json` returns `error: no_releases`, empty `latest_version`, and `update_available: false`; therefore this run did not trust the updater alone.
- Upstream docs say the daily update check should ask for explicit approval before installing. No blind auto-upgrade should run in production.
- Recent upstream issues reviewed include #587, #579, #578, #574, #569, #561, #550, #544, #540. Issue #578 matches an observed risk: `gbrain sync --help` performs a live sync.

## Runtime Health Evidence

Commands run:

```bash
railway up --project fbdb217b-060f-4f1e-8697-08a6288a19c4 --environment production --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 --detach --message "preserve railway env while loading persistent gbrain env"
npm run verify:gbrain -- --gbrain-install-readonly
npm run verify:gbrain -- --runtime-readonly
GBRAIN_VERIFY_SINCE=5m npm run verify:gbrain -- --railway-current
npm run canary:gbrain
openclaw agent --agent main --session-id codex-gbrain-broad-openclaw-canary-20260504 --message "<safe OpenClaw-mediated GBrain canary>" --json --timeout 900
```

Key outputs:

- Deployment `8f4b1abf-15d0-4052-87e2-348e1555d282`: `SUCCESS`, `stopped:false`.
- `/app/node_modules/.bin/alphaclaw --version`: `0.9.13`.
- `/app/node_modules/.bin/openclaw --version`: `OpenClaw 2026.5.2 (8b2a6e5)`.
- `/data/.bun/bin/gbrain --version`: `gbrain 0.26.6`.
- `/health`: `{"status":"healthy","gateway":"running"}`.
- Runtime GBrain install: branch `master`, head `f79cad0d45147b35d429ce94e6c81be3716d552e`, `status_short_count=0`.
- Fresh log summary: `token_mismatch=0`, `sessions/store=0`, rate-limit loop `0`.
- Full `gbrain doctor --json`: `status=warnings`, `health_score=90`.
- Doctor green checks: connection, pgvector, RLS, schema version `35`, embeddings `100% coverage, 0 missing`, graph coverage, JSONB integrity, markdown body completeness, eval capture, queue health, supervisor.
- Doctor accepted warnings: 37 resolver routing fixture warnings; 4129 frontmatter `MISSING_OPEN` issues across 21 sources.
- GBrain supervisor: running, pid `90`, crashes_24h `0`.
- Job stats: `embed 8/8 done`, `extract 1/1 done`, queue `0 waiting, 0 active, 0 stalled`.

## Feature Canary

`npm run canary:gbrain` passed against the live Railway/Supabase runtime.

Canary slugs:
- `system/canaries/gbrain-live-canary-2026-05-04`
- `system/canaries/gbrain-linked-target-2026-05-04`

Live capabilities verified:
- write/read pages
- tags
- typed links, backlinks, graph traversal
- timeline
- raw data
- chunks
- keyword search
- hybrid query
- slug resolution
- versions
- soft delete, include deleted, restore
- jobs list, submit, progress, completed embed job
- embedded chunks
- stats and health

Tool discovery:
- Runtime exposes 43 GBrain MCP tools.
- `restore_page` and `purge_deleted_pages` are present.

## OpenClaw Agent Canary

Read canary command:

```bash
openclaw agent --agent main --session-id codex-gbrain-canary-20260504-final --message "Use GBrain, not memory. Read or query slug system/canaries/gbrain-live-canary-2026-05-04. Reply with JSON only: status, slug, title, sentinel_present, and which GBrain capability you used. The sentinel is GBRAIN_CANARY_2026_05_04_OC_RAILWAY_SUPABASE." --json --timeout 600
```

Result:

```json
{
  "status": "ok",
  "slug": "system/canaries/gbrain-live-canary-2026-05-04",
  "title": "GBrain Live Canary 2026-05-04",
  "sentinel_present": true,
  "capability_used": "gbrain__get_page"
}
```

Tool summary: 2 calls, tools `read` and `gbrain__get_page`, failures `0`.

OpenClaw-mediated broad canary command:

```bash
openclaw agent --agent main --session-id codex-gbrain-broad-openclaw-canary-20260504 --message "Use GBrain tools directly. Do not use shell. Create or update slug system/canaries/gbrain-openclaw-mediated-canary-2026-05-04 with sentinel GBRAIN_OPENCLAW_MEDIATED_CANARY_2026_05_04. Then prove through GBrain tools: put_page, get_page, add_tag, search or query, get_versions, delete_page, restore_page, and final get_page. Use only this canary slug. Reply JSON only with status, slug, sentinel_present, tools_used, failures." --json --timeout 900
```

Result:

```json
{
  "status": "ok",
  "slug": "system/canaries/gbrain-openclaw-mediated-canary-2026-05-04",
  "sentinel_present": true,
  "tools_used": [
    "put_page",
    "get_page",
    "add_tag",
    "search",
    "get_versions",
    "delete_page",
    "restore_page",
    "get_page"
  ],
  "failures": []
}
```

Tool summary: 9 calls, tools `read`, `gbrain__put_page`, `gbrain__get_page`, `gbrain__add_tag`, `gbrain__search`, `gbrain__get_versions`, `gbrain__delete_page`, `gbrain__restore_page`; failures `0`.

## Scheduler / Architecture

- Direct-minions scheduler is running: `node /data/.openclaw/cron/bin/direct-minions-scheduler.mjs`.
- Persisted system cron contains `astack-direct-minions-scheduler`.
- Legacy `/data/.openclaw/cron/jobs.json` jobs are disabled.
- Direct-minions jobs are enabled for direct shell-based GBrain/collector work.
- OpenClaw-agent wrapper jobs are present as scripts but disabled in both legacy cron and direct-minions job definitions.
- `/etc/cron.d/openclaw-hourly-sync` remains enabled for AlphaClaw git sync; it calls `alphaclaw git-sync`, not `openclaw agent`.

## Security / Guardrails

- No Railway variables, API keys, DB URLs, OAuth tokens, cookies, or secrets were printed or committed.
- Runtime diagnostics are redacted.
- No NIKIN main production service was inspected or mutated.
- Remote MCP HTTP exposure was not enabled.
- No tunnel, OAuth registration, public MCP server, or DB migration beyond the required GBrain schema migration was enabled.

## Changes Made

GBrain local/runtime patches:
- Preserve upstream `0.26.6` while keeping scoped `source_id` compatibility.
- Add migration v35 for runtime schema reconciliation.
- Harden bootstrap for admin/OAuth columns used by current upstream schema.

OpenClaw runtime repo changes:
- Upgrade `@chrysb/alphaclaw` to `0.9.13`.
- Keep `openclaw` override at `2026.5.2`.
- Add `scripts/gbrain-live-canary.mjs`.
- Make AlphaClaw process patch compatible with `0.9.13`.
- Load persistent runtime env before starting GBrain supervisor, without overriding existing non-empty Railway env vars.
- Update verifier pinned upstream GBrain SHA and local non-executable GBrain handling.

## Concerns

- `gbrain check-update --json` currently reports `no_releases`, so automatic update detection is advisory only until upstream releases are discoverable.
- `gbrain sync --help` has a live side effect; upstream issue #578 tracks this risk.
- Doctor warnings remain for resolver routing fixtures and frontmatter validation.
- Five historical dead shell jobs remain in job history; current queue is healthy and no new embed failures occurred after the env fix.
- One failed intermediate deploy (`36fc740a-e2f9-4536-a06b-bc4248a2e808`) occurred because a persistent empty env placeholder overrode runtime auth expectations. Final deploy fixed this by preserving existing non-empty env vars.

## Oracle Pro Final Gate

Oracle Pro browser run `gbrain-openclaw-final-dod-20260504-2` reviewed the report and diff.

Recommendation: `PASS_WITH_CONCERNS`.

Oracle found no hard blocker before daily dogfooding. It agreed the live Railway/Supabase GBrain runtime is healthy and that OpenClaw can call GBrain. It asked for a broader OpenClaw-mediated canary, a clean commit, stale-doc reconciliation, verifier redaction hardening, and an update-check fallback because GitHub releases are not discoverable. The broad OpenClaw canary, stale-doc marker, and verifier redaction hardening were completed after that review.

## Dogfood Commands

```bash
npm run verify:gbrain -- --runtime-readonly
npm run canary:gbrain
GBRAIN_VERIFY_SINCE=10m npm run verify:gbrain -- --railway-current
railway ssh --project fbdb217b-060f-4f1e-8697-08a6288a19c4 --environment production --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 'env HOME=/data GBRAIN_HOME=/data BRAIN_REPO=/data/brain BUN_INSTALL=/data/.bun PATH=/data/.bun/bin:/app/node_modules/.bin:$PATH /data/.bun/bin/gbrain check-update --json'
```

## Rollback

- Runtime GBrain backup: `/data/.gbrain-upgrade-backups/20260504T081817Z-0.26.6-upgrade`.
- Previous failed deploy is `36fc740a-e2f9-4536-a06b-bc4248a2e808`; do not redeploy it.
- Current known good deploy is `8f4b1abf-15d0-4052-87e2-348e1555d282`.
- To roll back repo code, revert the OpenClaw runtime repo commit that contains this report and the AlphaClaw/GBrain canary changes, then deploy the reverted commit to the target service only.
