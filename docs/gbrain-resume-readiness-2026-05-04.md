# GBrain/OpenClaw Resume Readiness - 2026-05-04

Final status: `PASS_WITH_CONCERNS`

This is the resumed `/goal` pass for making GBrain a shared productivity layer across Railway OpenClaw, local Codex, local Claude Code, and future Treeki/NIKIN workflows.

Native Codex goal note: the built-in goal record in this thread was already marked `complete` for the earlier GBrain readiness objective, so a second native `/goal` could not be created. This document is the active resume contract and evidence ledger for the pasted 12-gate goal.

## Target Scope

- Railway project: `ravishing-enjoyment` (`fbdb217b-060f-4f1e-8697-08a6288a19c4`)
- Environment: `production` (`614198f2-f7ed-4756-ae83-e0dd23943c9d`)
- OpenClaw target service: `openclaw-railway-template` (`6f333a2b-07d9-4219-8531-3b96fbc6a2f9`)
- Remote MCP service: `gbrain-remote-mcp` (`beab847a-12bb-499e-a44c-bf5d1982924f`)
- Forbidden service: `NIKIN - MAIN OC INSTANCE [PRODUCTION]` (`63b84308-25d7-4b03-9c23-4d0d7239728f`)

No logs, SSH, variables, deploy, restart, or mutation were run against the forbidden service. One `railway service status --all` command returned its name/id as part of project-wide service listing; no further access was made.

## Version Matrix

| Area | Version / SHA | Status |
| --- | --- | --- |
| GBrain upstream | `https://github.com/garrytan/gbrain`, `9e2093fc9bb6cb46520e58b0c95b807e788d9606` | pinned |
| Runtime GBrain | `0.26.6` | current |
| Local GBrain | `0.26.6` | current |
| Upstream local checkout | `/Users/arshya/gbrain`, branch `codex-gbrain-0.26.6-runtime-patches`, head `72d061e`, upstream `origin/master` `9e2093f` | local runtime-patch branch; binary version current |
| OpenClaw | `2026.5.2` | pinned for AlphaClaw |
| AlphaClaw | `0.9.13` | current |
| npm latest OpenClaw observed | `2026.5.3-1` | not adopted because AlphaClaw `0.9.13` declares `openclaw@2026.5.2` |

## Gate Table

| Gate | Status | Evidence |
| --- | --- | --- |
| 1. Baseline | pass | OpenClaw target deploy `8f4b1abf-15d0-4052-87e2-348e1555d282` still `SUCCESS`; remote MCP deploy `1d3d944a-23ee-4914-807e-ac65908b8f4b` `SUCCESS` |
| 2. Upstream alignment | pass | Upstream repo/docs/source inspected; remote OAuth, DCR, localOnly operations, token flow, and version pins verified |
| 3. Remote MCP/OAuth design | pass | New isolated Railway service keeps OpenClaw stdio MCP unchanged and exposes upstream `gbrain serve --http` |
| 4. Remote MCP/OAuth runtime | pass with concern | `/health` ok, missing token `401`, DCR `/register` disabled `404`, CORS preflight default-deny, OAuth client_credentials `read write` canary passed; bad token returns upstream `500` but remains fail-closed |
| 5. Local `$setup-gbrain` | pass | Local GBrain switched from disconnected PGLite to shared Supabase/Postgres; backup at `~/.gbrain/config.json.bak-20260504171428` |
| 6. Local Claude Code | blocked concern | `claude mcp list` connects to `gbrain`; real tool-call canary blocked by Claude quota: `You've hit your limit · resets 2am (Europe/Zurich)` |
| 7. Local Codex | pass | Global Codex MCP `gbrain` registered; `codex exec` used `gbrain.get_page` and returned the live canary page |
| 8. Canaries | pass | Direct GBrain canary `PASS`; remote OAuth canary `PASS`; OpenClaw-mediated canary `status: ok` via embedded `openai/gpt-5.4` |
| 9. Tool coverage | pass | Pages, search/query, tags, links, graph, timeline, raw data, chunks, versions, jobs, health/stats, and remote localOnly filtering covered |
| 10. Update flow | pass with concern | `gbrain check-update --json` still returns `no_releases`; fallback is upstream SHA/package inspection plus approval-gated `gbrain upgrade` |
| 11. Doctor warnings | concern | Full doctor: health `95`, DB/pgvector/RLS/schema/embeddings/frontmatter ok, but resolver health has 37 upstream routing fixture warnings |
| 12. Final review | pass with concerns | Oracle Pro completed; recommendation was to keep overall `PASS_WITH_CONCERNS`, reject FULL PASS, and treat remote MCP/OAuth as blocked until secret-scan false positives and old token logging risk were closed. Those two blockers were then triaged with evidence below. |

## Implemented Changes

- Added `services/gbrain-remote-mcp/` Dockerized Railway service wrapper.
- Added runtime safety patch for upstream HTTP server:
  - CORS default-deny unless `GBRAIN_HTTP_CORS_ORIGIN` is explicitly set.
  - Admin bootstrap token suppressed in Railway logs.
  - DCR remains disabled by default.
- Added `scripts/gbrain-remote-mcp-canary.mjs`.
- Added npm script `canary:gbrain-remote`.
- Registered local Codex global MCP server `gbrain`.
- Updated local GBrain config to shared Supabase/Postgres, preserving a PGLite backup.
- Repaired local GBrain CLI executability by changing `/Users/arshya/gbrain/src/cli.ts` mode from `100644` to `100755`; this is a local upstream-checkout mode-bit change, not part of this runtime repo commit.

## Command Evidence

```bash
~/.claude/skills/gstack/bin/gstack-gbrain-detect
# gbrain_engine: postgres
```

```bash
claude mcp list
# gbrain: /Users/arshya/.bun/bin/gbrain serve - connected
```

```bash
codex mcp list
# gbrain: /Users/arshya/.bun/bin/gbrain serve
```

```bash
codex exec ... "Call GBrain get_page..."
# mcp_used: gbrain.get_page
# found_slug: system/canaries/gbrain-live-canary-2026-05-04
```

```bash
npm run canary:gbrain
# status: PASS
```

```bash
npm run canary:gbrain-remote
# status: PASS
# auth: oauth_client_credentials
# exposed_tool_count: 38
# missing_token: 401
# bad_token: 500, fail-closed concern
# cors_default_deny: PASS, no access-control-allow-origin
# dcr_disabled: 404
```

```bash
oracle-pro-context ...
# Secret scan warning was inspected before sending.
# False positives: environment variable names, the fixed bad-token canary string,
# and README prose mentioning OAuth/bearer credentials.
```

```bash
railway logs <old remote deploy ids> --json
# extracted_old_admin_token_count: 2
# current_login_statuses: 401, 401
# all_old_tokens_rejected_by_current_deploy: true
```

```bash
railway logs --service gbrain-remote-mcp --json
# raw_admin_token_banner_present: false
# bearer_token_present: false
# database_url_present: false
# client_secret_present: false
# authorization_header_present: false
```

```bash
npm run verify:gbrain -- --railway-current
# deploy: 8f4b1abf-15d0-4052-87e2-348e1555d282 SUCCESS
# current_token_mismatch_lines: 0
# current_sessions_store_lines: 0
# current_rate_limit_lines: 0
```

```bash
npm run verify:gbrain -- --dead-jobs-readonly
# recent dead shell jobs 1773, 1764, 1747: openai-codex/gpt-5.5 cooldown / rate_limit
# older dead shell jobs 1478, 1458: same cooldown pattern plus disabled plugin config warning
```

```bash
openclaw agent --model openai/gpt-5.4 ...
# status: ok
# tools_used: read, gbrain__get_page
```

```bash
gbrain doctor --json
# status: warnings
# health_score: 95
# embeddings: 100% coverage, 0 missing
# frontmatter: clean
# only warning: resolver_health, 37 routing_miss warnings
```

## Security Posture

- No public unauthenticated MCP: missing token is rejected.
- CORS default-deny verified: foreign Origin probe did not receive `access-control-allow-origin`.
- DCR disabled.
- Canary OAuth client was revoked after testing.
- Remote service does not log the admin bootstrap token after deploy `1d3d944a-23ee-4914-807e-ac65908b8f4b`.
- Two admin bootstrap tokens from superseded remote-MCP deployments were parsed only from a 0600 temp file, never printed, tested against the current deploy, and rejected with `401`; temp files were deleted.
- Fresh remote-MCP logs were scanned after canaries and contain no raw admin token, bearer token, DB URL, client secret, Authorization header, or API-key-like string.
- Secrets were handled through stdin/temp files or existing local 0600 config and were not committed.

Known security concern: upstream HTTP bearer auth returns `500` for an invalid token instead of a clean `401/403`. This is fail-closed but should be fixed upstream or patched before claiming strict FULL PASS. Additional remote-MCP negative tests still needed for strict pass: read-only scope write denial, revoked-client token mint denial, expired-token behavior, admin route denial for non-admin credentials, and positive allowlisted CORS if browser clients are introduced.

Incident note: a mistaken `gbrain auth register-client --help` invocation created and printed one temporary test client secret in local tool output. That client was immediately revoked by id, remaining `remote-mcp-canary-*` test clients were deleted, and no secret was committed or left active.

## Runtime Health

- OpenClaw service: `SUCCESS`, deployment `8f4b1abf-15d0-4052-87e2-348e1555d282`
- Remote MCP service: `SUCCESS`, deployment `1d3d944a-23ee-4914-807e-ac65908b8f4b`
- Current target logs: no `token_mismatch`, no `sessions/store` storm, no rate-limit loop in the checked 10-minute window.
- GBrain supervisor: running, `0` crashes in 24h.
- Direct-minions scheduler: active.
- Enabled cron wrappers for migrated OpenClaw-agent jobs: not present.

Concern: runtime job stats show `3` dead `shell` jobs in the last 24h and `5` dead jobs in the shown history. The reviewed failures are OpenClaw model-execution jobs dying after repeated `openai-codex/gpt-5.5` cooldown/rate-limit failures, not GBrain embed/indexer failures. Queue is currently empty and embed jobs are green, but scheduled shell workloads need a model fallback/quota policy before strict FULL PASS.

## Rollback

Remote MCP rollback:

Pause or remove only service `gbrain-remote-mcp` (`beab847a-12bb-499e-a44c-bf5d1982924f`) in the Railway dashboard. Do not use a broad project rollback and do not mutate `openclaw-railway-template`. Avoid `railway down` as the first rollback lever here because older superseded remote-MCP deploys had unsafe token logging; rollback should disable/remove the isolated service, not re-activate an older deployment.

Local GBrain rollback:

```bash
cp -p ~/.gbrain/config.json.bak-20260504171428 ~/.gbrain/config.json
```

Token rollback:

```bash
gbrain auth revoke-client <client_id>
gbrain auth revoke <legacy-token-name>
```

OpenClaw rollback: no change was made to the existing OpenClaw target service deployment.

## Dogfood Commands

```bash
gbrain doctor --json
gbrain call get_page '{"slug":"system/canaries/gbrain-live-canary-2026-05-04"}'
codex exec --skip-git-repo-check -C /Users/arshya/Desktop/AI.nosync/astack 'Use gbrain MCP get_page for system/canaries/gbrain-live-canary-2026-05-04.'
npm run canary:gbrain
```

Remote MCP canary requires a temporary OAuth client or bearer token:

```bash
GBRAIN_REMOTE_MCP_URL=https://gbrain-remote-mcp-production.up.railway.app \
GBRAIN_REMOTE_OAUTH_CLIENT_ID=... \
GBRAIN_REMOTE_OAUTH_CLIENT_SECRET=... \
npm run canary:gbrain-remote
```

## Remaining To Reach FULL PASS

1. Fix or upstream-file the bad-token `500` behavior so invalid auth returns clean `401/403`.
2. Fix the 37 resolver routing warnings or get them accepted upstream as non-readiness warnings.
3. Re-run Claude Code tool-call canary after quota reset.
4. Add/verify a scheduler model fallback/quota policy for shell jobs that currently request `openai-codex/gpt-5.5` and die during cooldown.
5. Expand remote MCP negative canaries for read-only scope denial, revoked-client denial, expired-token denial, and admin-route denial.
