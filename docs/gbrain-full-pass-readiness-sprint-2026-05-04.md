# GBrain Full-Pass Readiness Sprint - 2026-05-04

Status: `PASS_WITH_CONCERNS` (`FULL_PASS_BLOCKED`)

This is the astack-owned follow-up sprint for the remaining GBrain full-pass blockers. It continues from `docs/gbrain-resume-readiness-2026-05-04.md` and does not reset the earlier evidence.

## Scope

- OpenClaw target service: `openclaw-railway-template` (`6f333a2b-07d9-4219-8531-3b96fbc6a2f9`)
- Railway project/env: `ravishing-enjoyment` / `production`
- Forbidden service: `NIKIN - MAIN OC INSTANCE [PRODUCTION]` (`63b84308-25d7-4b03-9c23-4d0d7239728f`)
- Remote MCP target service: `gbrain-remote-mcp` (`beab847a-12bb-499e-a44c-bf5d1982924f`)
- Remote MCP service code: `services/gbrain-remote-mcp/`
- GBrain upstream: `https://github.com/garrytan/gbrain`

Allowed Railway operations in this sprint are limited to the OpenClaw target service and the Remote MCP target service above: status, logs, SSH diagnostics, explicit canaries, and approved reversible runtime fixes. Every other service ID is refused, especially the forbidden production service. No targeted command inspected, mutated, restarted, deployed, SSHed into, or tailed logs/variables for the forbidden service. A project-level `railway status --json` service listing included the forbidden service name/id while separating the approved Remote MCP target; no further forbidden-service access was performed.

## Hunt-First Diagnosis

| Bucket | Finding |
| --- | --- |
| Already working | OpenClaw target service healthy, runtime GBrain `0.26.7`, stdio MCP configured, supervisor running on the post-upgrade boot path, direct/remote/Codex GBrain canaries passed. `embed --stale --dry-run` now reports 0 stale chunks after the source-scoped embedding fix. |
| Working but not FULL PASS | Runtime doctor remains `warnings`; scheduled shell-job health needs the fresh post-quota-guard 24-48h observation window; remote MCP is live-hardened but still carries an astack patch until upstream PR #620 lands; runtime GBrain carries the source-scoped stale-embed patch until upstream PR #626 is merged/consumed. |
| Missing evidence | No local-agent evidence gap remains: Claude Code and Codex both completed real shared-GBrain toolcall canaries. |
| Real blockers | Running direct-minions scheduler ignored `enabled:false`; this produced fresh dead shell jobs from disabled OpenClaw-agent wrapper jobs. A second blocker was found and fixed: upstream `embed --stale` grouped by slug even though slugs are unique only per `source_id`, leaving stale chunks unembedded on duplicate-slug sources. A third blocker was found and deployed on 2026-05-05: enabled `x-bookmarks-daily` can die from X/Twitter `CreditsDepleted`; the live shell-job quota guard now converts that known external quota condition into a recorded skip instead of a GBrain `DEAD` job. |
| Security risks | Remote MCP must return clean auth status, keep DCR disabled, keep CORS default-deny, and avoid auth material in logs. |
| Not worth doing now | Custom MCP gateway, broad project rollback, re-enabling OpenClaw-agent scheduled wrappers without quota policy. |

## Workstream Status

| Workstream | Status | Evidence |
| --- | --- | --- |
| 1. Remote MCP hardening | live pass, upstream patch pending | Remote deployment `aa3baa40-a303-4bc0-890f-99a8120cbf69` runs GBrain `0.26.7` with the astack wrapper plus the upstream-aligned `InvalidTokenError` provider patch from PR #620. Full remote canary now passes and is part of `verify:gbrain-full-pass-gates`: missing token `401`, bad token `401`, expired token `401`, revoked client denial `400`, DCR disabled `404`, admin denial `404`, CORS default-deny, log redaction, read-only write denial, tools list, read/write/search/version/delete/restore, and OAuth fixture client revocation. Upstream issue: <https://github.com/garrytan/gbrain/issues/616>. Upstream fix PR: <https://github.com/garrytan/gbrain/pull/620>. |
| 2. Scheduler/quota fix | live pass, 24-48h monitoring pending | Deployment `9a87eb62-612d-4bdf-9ed7-b99c495edfdc` adds the external-quota shell-job guard on top of the corrected astack-owned scheduler/wrapper and hardened GBrain supervisor boot. Runtime validate: `enabled_cron=12`, `disabled_cron=7`, enabled OpenClaw-agent wrappers `0`. A read-only check had found job `1894` from enabled `x-bookmarks-daily`, caused by X/Twitter `CreditsDepleted`, not OpenClaw model cooldown. Commit `258eb89` added `astack-shell-job-runner.sh` and `gbrain-submit-shell-job.sh`; live canary job `1941` proved a fake `CreditsDepleted` shell job completed with `skipped_external_quota` instead of becoming `DEAD`. Latest gate after deploy is `BLOCKED`, not `FAIL`: `0.05h/24h`, no new dead jobs after cutoff. `openclaw-agent-job.sh` still defaults to `openai/gpt-5.4` if intentionally enabled and preserves failure exit codes across no-fallback, fallback-success, and fallback-fail paths. |
| 3. Claude Code canary | pass | After the 2am Europe/Zurich quota reset, `npm run canary:gbrain-claude` passed with real GBrain MCP operations: get_page, put_page, search, delete_page, include_deleted get_page, restore_page, and final get_page. Latest full gate evidence slug: `system/canaries/gbrain-claude-code-canary-2026-05-05`. |
| 4. Doctor warnings/upstream route | frontmatter fixed, resolver upstream PR open, stale-embed patch live | Runtime frontmatter audit is now clean: `ok=true,total=0` after the targeted runtime source fix. Runtime `embed --stale` is also clean after cherry-picking PR #626 into `/data/gbrain`: dry-run now reports `Would embed 0 chunks`. Runtime doctor still warns on 37 shipped skill routing misses on GBrain `0.26.7`. Upstream resolver issue: <https://github.com/garrytan/gbrain/issues/617>. Resolver fix PR: <https://github.com/garrytan/gbrain/pull/619>. Stale-embed fix PR: <https://github.com/garrytan/gbrain/pull/626>. |
| 5. Update flow automation | currentness blocked by new upstream | `npm run check:gbrain-upstream -- --json` now sees upstream `ee9ceb327a39b0c705ee945c6cfe821de11d34ed` / `0.27.0`. Runtime remains `d050451df5852cc7414601e92b927469e374f75e` / `0.26.7` with PR #626 cherry-picked; Docker/verifier pins remain `058fe695...`. The guarded upgrade plan reports runtime version, target package version, current upstream migrations, and migration v35 RLS impact. A prior read-only v35 audit on the target DB found `non_exempt_public_tables_without_rls=0`, so the RLS backfill would not currently flip any existing non-exempt public table. Runtime was not upgraded in this pass because pure upstream `0.27.0` would drop the live #626 patch unless upstream consumes the PRs or a custom combined runtime cut is explicitly accepted. The custom combined cut path remains explicitly double-gated and requires `GBRAIN_RUNTIME_CUSTOM_CUT_APPROVED=openclaw-gbrain-custom-runtime-cut` plus an explicit fork fetch URL/ref. |
| 6. Remote MCP product interface | live pass with upstream concern | astack keeps upstream `gbrain serve --http`, owns the Railway deploy/env/token policy/canary/rollback layer, and now has live OAuth-backed canary evidence on `gbrain-remote-mcp`. The only remaining concern is that the InvalidTokenError provider fix is astack-applied until PR #620 is landed or consumed upstream. |

## Selected Path

Decision at `2026-05-05T01:05:11Z`: use the upstream-clean wait path, not the custom runtime cut.

- Custom runtime cut remains not approved. Do not execute a custom GBrain runtime checkout unless this decision is explicitly reversed with `openclaw-gbrain-custom-runtime-cut`.
- Wait for upstream PR #619, #620, and #626 to be merged or otherwise consumed, then update/pin the OpenClaw runtime and durable astack pins against upstream.
- Scheduler burn-in restarted after deploying the astack shell-job quota guard. The previous burn-in window was invalidated by job `1894` at `2026-05-05T01:17:05Z`; the new cutoff is `2026-05-05T05:55:53Z`.
- Latest quick gate after this decision remains `BLOCKED`: PRs open/mergeable, runtime `0.26.7` versus upstream `0.27.0`, doctor `resolver_health` warnings, scheduler burn-in failed on job `1894`, no current token/session/rate-limit logs, secret scan pass.

## Completion Audit Snapshot

Checked at `2026-05-05T00:56:53Z`. Result: `NOT_FULL_PASS`.

| Requirement | Evidence | Status |
| --- | --- | --- |
| Remote MCP bad/missing/expired bearer tokens return clean auth failures | Latest full `npm run verify:gbrain-full-pass-gates -- --json` includes `remote_mcp_oauth_fixture_canary`, which passed: missing token `401`, bad token `401`, expired token `401`, revoked client denial `400`, and fixture clients revoked. | pass in astack, upstream patch pending |
| Remote MCP DCR, admin route, CORS, log-redaction, scoped write denial covered | Fixture canary passed DCR disabled `404`, admin denial `404`, CORS default-deny, log redaction, and read-only write denial. | pass |
| Remote MCP uses upstream `gbrain serve --http`, not a custom gateway | `services/gbrain-remote-mcp/start-gbrain-http.mjs` launches upstream HTTP serve with environment hardening and a temporary safety patch. | pass with concern |
| Upstream GBrain owns core resolver/auth/embedding behavior | PR #619, PR #620, and PR #626 are open and mergeable, not merged/consumed. Non-merged PR states are now hard `BLOCKED`, not warnings. | blocked |
| Direct GBrain live canary covers read/write/search/query/graph/timeline/raw/chunks/jobs/embed/delete/restore/health | After PR #626 was cherry-picked into runtime as `d050451`, stale embed job `1861` embedded 14 chunks. The direct canary now also submits a global stale-embed job before final health; latest full gate passed with `chunk_count=36097`, `embedded_count=36097`, `embed_coverage=1`, `missing_embeddings=0`, `brain_score=85`. | pass with upstream concern |
| Scheduler no longer creates OpenClaw agent-wrapper sessions for migrated jobs | Runtime validate reports `enabled_agent_wrapper_count=0`; disabled wrapper jobs remain disabled. | pass |
| Scheduler quota/cooldown fix has enough burn-in | Deployment `9a87eb62...` is live and canary job `1941` proved external quota skip behavior. Latest gate reports `0.05h/24h`, no new dead jobs after cutoff. | blocked |
| Claude Code accesses the shared GBrain with a real tool call | Full gate passed `claude_code_shared_gbrain_canary`: get_page, put_page, search, delete_page, get_page include_deleted, restore_page, final get_page, plus independent final-state verification through direct GBrain `get_page`. | pass |
| Codex accesses the shared GBrain with real tool calls | The full-pass gate passed `codex_shared_gbrain_canary`: health, search, put/get, delete, and restore against the shared GBrain MCP, plus independent final-state verification through direct GBrain `get_page`. Both Codex phases now use an explicit isolated GBrain MCP config. | pass |
| Runtime GBrain doctor is `ok` | Runtime `gbrain frontmatter audit --json` is clean (`ok=true,total=0`). Runtime `gbrain doctor --json` now reports `health_score=95`; the only remaining doctor warning is `resolver_health` with 37 shipped routing warnings. | blocked |
| Latest safe GBrain version is used or explicitly pinned | Upstream is now `ee9ceb327a39b0c705ee945c6cfe821de11d34ed` / `0.27.0`. Runtime GBrain is `0.26.7` plus runtime cherry-pick `d050451` from PR #626; Remote MCP Docker pin and verifier pin still point at `058fe695...`. Current upstream still includes migration v35 auto-RLS; read-only audit found 0 non-exempt public tables without RLS. Upgrade remains blocked until PR #619/#620/#626 are merged/consumed or a custom combined runtime cut is explicitly accepted. | blocked by new upstream and custom runtime patch |
| Local GBrain checkout is safe to update | `/Users/arshya/gbrain` is on `codex-gbrain-0.26.6-runtime-patches` with a dirty mode-only `src/cli.ts` change; it was intentionally not overwritten. | warning |
| Runtime health has no current session/token/rate-limit storm | `GBRAIN_VERIFY_SINCE=30m npm run verify:gbrain -- --railway-current` reports current total/token/session/rate-limit lines all `0`. | pass |
| Secrets not committed or printed in durable artifacts | Full gate scans the complete git diff plus durable readiness artifacts for GBrain tokens, DB URLs, OpenAI keys, bearer tokens, GitHub tokens, and literal client secrets; latest scan passed with `diff_bytes_scanned=0`. | pass |
| Forbidden NIKIN production service untouched | No targeted command inspected/mutated/restarted/deployed/SSHed/logged the forbidden service; fixture script refuses its service ID with exit `2`. | pass |

Conclusion: AStack has a working and useful dogfood layer, including live Remote MCP/OAuth, runtime GBrain `0.26.7`, and real shared-GBrain canaries from Claude Code and Codex. The broad frontmatter doctor blocker and stale-embedding blocker are fixed in the live target service. FULL PASS remains blocked by upstream PR landing/consumption, deployment plus burn-in of the new X/Twitter external-quota shell-job guard, the runtime cherry-pick, the upstream `0.27.0` currentness delta, and the remaining resolver doctor warning.

## Prompt-to-Artifact Checklist

| Goal requirement | Artifact or command evidence | Coverage |
| --- | --- | --- |
| Start from read-only baseline and correct target | `Scope` section, `verify:gbrain -- --railway-current`, `verify:gbrain -- --dead-jobs-readonly`, target IDs hard-coded in verifiers. | pass |
| Create branch `astack/gbrain-full-pass-readiness` | Current repo branch and pushed commits on `fork/astack/gbrain-full-pass-readiness`. | pass |
| User decision on runtime path | `Selected Path` section records upstream-clean wait; custom runtime cut remains not approved. | pass |
| Hunt-first diagnosis with six buckets | `Hunt-First Diagnosis` section. | pass |
| Remote MCP bad bearer tokens return `401/403`, not `500` | `services/gbrain-remote-mcp/start-gbrain-http.mjs`, `scripts/gbrain-remote-mcp-canary.mjs`, `scripts/gbrain-remote-mcp-fixture-canary.sh`, latest full gate `remote_mcp_oauth_fixture_canary`. | pass in astack, upstream PR #620 pending |
| Remote MCP canaries cover missing/bad/expired/revoked/read-only/admin/DCR/CORS/log-redaction | Latest full gate evidence at `2026-05-05T00:56:53Z`: all named steps PASS, fixture clients revoked. | pass |
| Upstream GBrain issue/PR opened for auth behavior | Issue #616 and PR #620. | pass, not merged |
| Scheduler respects disabled migrated OpenClaw-agent jobs | `patches/direct-minions-scheduler.mjs`, `patches/start-astack.sh`, runtime validate `enabled_agent_wrapper_count=0`. | pass |
| Scheduler shell-job fallback/skip/backoff path exists | `patches/openclaw-agent-job.sh`, `scripts/test-openclaw-agent-job.sh`, `npm run test:openclaw-agent-job`. | pass |
| Scheduler done means 24-48h no new dead jobs | Gate currently reports no new dead jobs after new cutoff `2026-05-05T05:55:53Z`, but only `0.05h/24h` burn-in has elapsed. | blocked |
| Claude Code uses shared live GBrain with real toolcalls | `scripts/gbrain-claude-code-canary.sh`, latest full gate `claude_code_shared_gbrain_canary` PASS with get/search/write/delete/restore and direct final-state verification. | pass |
| Codex uses shared live GBrain with real toolcalls | `scripts/gbrain-codex-canary.sh`, latest full gate `codex_shared_gbrain_canary` PASS with health/search/write/read/delete/restore and direct final-state verification. | pass |
| Resolver doctor warnings investigated and routed upstream | Issue #617 and PR #619; runtime doctor gate still warns until consumed. | blocked |
| FULL PASS requires `gbrain doctor --json` ok | Latest full gate `runtime_gbrain_doctor` status `warnings`, `resolver_health` only. | blocked |
| `check-gbrain-upstream` exists and compares upstream/runtime/local/pins | `scripts/check-gbrain-upstream.mjs`, npm script `check:gbrain-upstream`, latest full gate `update_flow_currentness`. | pass script, blocked currentness |
| Do not rely only on `gbrain check-update --json` | `check:gbrain-upstream` reads GitHub SHA/package, npm advisory package, runtime SHA/version, local checkout, Docker/verifier pins. | pass |
| Upgrade is approval-gated with backup/migrate/doctor/canaries/rollback | `scripts/gbrain-runtime-upgrade-gate.mjs`, npm script `upgrade:gbrain-runtime`, rollback section. | pass gate, upgrade not executed to `0.26.8` |
| Custom runtime cut cannot execute accidentally | `upgrade:gbrain-runtime` requires normal approval, custom approval, and explicit fetch URL/ref for non-upstream SHA. | pass |
| Remote MCP remains upstream `gbrain serve --http`, no custom gateway | `services/gbrain-remote-mcp/start-gbrain-http.mjs`; report states astack owns deploy/env/token/canary/rollback only. | pass with upstream concern |
| No forbidden NIKIN production access | Target guards in fixture/full-pass scripts; report states no targeted forbidden service inspect/mutate/restart/deploy/SSH/logs. | pass |
| No secrets printed, stored, committed, or exfiltrated | `secret_scan_full_diff_and_artifacts` PASS, fixture canary revokes clients and redacts secrets. | pass |
| Runtime mutations/restarts/deploys are checkpointed | Runtime upgrade/frontmatter/source-patch scripts require explicit approval and record backup/rollback/canaries. | pass |
| Final deliverable includes 6-workstream table, commands/evidence, files changed, deploy/restart status, risks, rollback, dogfood commands | `Workstream Status`, `Command Evidence`, `Changes Made`, `Rollback`, `Next Dogfood Commands`, `Remaining FULL PASS Gates`. | pass |
| Do not claim FULL PASS unless all gates pass | Report status remains `PASS_WITH_CONCERNS` / `FULL_PASS_BLOCKED`; latest full gate status `BLOCKED`. | pass |

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
- Added `patches/astack-shell-job-runner.sh` and `patches/gbrain-submit-shell-job.sh`.
  - Routes scheduled GBrain shell jobs through a small runner when installed.
  - Converts known X/Twitter `CreditsDepleted` failures into a sanitized `skipped_external_quota` skip, preventing GBrain `DEAD` retries for exhausted external API credits.
  - Preserves hard failure semantics for non-quota script errors.
- Added `scripts/test-gbrain-shell-job.sh` and npm script `test:gbrain-shell-job`.
  - Covers runner injection, success, known external quota skip, hard failure preservation, and fallback direct invocation if the runner is absent.
- Updated `patches/start-astack.sh`.
  - Installs the astack-owned direct-minions runtime scripts into `/data/.openclaw/cron/bin` at boot, backing up changed files first.
  - Starts the GBrain supervisor with an explicit `--cli-path /data/.bun/bin/gbrain`, required by GBrain `0.26.7` detached supervisor startup.
- Updated Remote MCP wrapper patch.
  - Adds a `/mcp` auth error handler that redacts auth failures and returns `401/403`.
  - Wraps the async `/mcp` handler in `try/catch next(err)` before the error middleware.
  - Applies the upstream-aligned OAuth provider `InvalidTokenError` patch from PR #620 so MCP SDK bearer auth returns clean `401 invalid_token` instead of `500`.
- Expanded `scripts/gbrain-remote-mcp-canary.mjs`.
  - Missing token, bad token, DCR disabled, CORS default-deny, admin-route denial, read-only write denial.
  - Env-backed checks for expired token, revoked client, and log redaction sample.
- Added `scripts/gbrain-remote-mcp-fixture-canary.sh` and npm script `canary:gbrain-remote-fixture`.
  - Creates short-lived Remote MCP OAuth fixture clients on the approved `gbrain-remote-mcp` service, runs the full OAuth-backed remote canary, and revokes the fixtures in cleanup.
  - Refuses any unapproved project/environment/service/URL, refuses the forbidden NIKIN production service ID, and emits verified Remote MCP service evidence for the full-pass gate.
- Added `scripts/check-gbrain-upstream.mjs` and npm script `check:gbrain-upstream`.
- Added `scripts/gbrain-runtime-upgrade-gate.mjs` and npm script `upgrade:gbrain-runtime`.
  - Defaults to plan mode.
  - Requires `GBRAIN_RUNTIME_UPGRADE_APPROVED=openclaw-gbrain-runtime-upgrade` for runtime mutation.
  - Requires a second explicit approval, `GBRAIN_RUNTIME_CUSTOM_CUT_APPROVED=openclaw-gbrain-custom-runtime-cut`, when `GBRAIN_RUNTIME_UPGRADE_SHA` is not upstream master.
  - Requires custom runtime cuts to declare `GBRAIN_RUNTIME_UPGRADE_FETCH_URL` and `GBRAIN_RUNTIME_UPGRADE_REF`; no custom runtime cut is approved on the upstream-clean wait path.
  - Captures a backup path, target SHA, expected impact, rollback, and required post-upgrade canaries.
  - Correctly reports detached runtime branch/version, target package version, current upstream migration posture, and migration v35 pre-execute RLS audit requirements.
  - Stops and restarts the GBrain supervisor with an explicit CLI path during future guarded runtime upgrades.
- Added `scripts/gbrain-claude-code-canary.sh` and npm script `canary:gbrain-claude`.
  - Runs the required Claude Code shared-GBrain get/search/write/delete/restore canary.
  - Returns machine-readable `BLOCKED_QUOTA` on Claude 429 instead of failing ambiguously.
  - Independently verifies the final canary page through direct GBrain `get_page`, so PASS is not only model self-attestation.
- Added `scripts/gbrain-codex-canary.sh` and npm script `canary:gbrain-codex`.
  - Runs a local Codex shared-GBrain MCP canary for health, search, put/get, delete, and restore.
  - Uses explicitly approval-bypassed noninteractive Codex phases for the reversible canary slug, after one gate run showed `put_page` could otherwise be cancelled while waiting for approval.
  - Uses the same explicit isolated GBrain MCP config in both Codex phases and independently verifies the final canary page through direct GBrain `get_page`.
- Added `scripts/verify-gbrain-full-pass-gates.mjs` and npm script `verify:gbrain-full-pass-gates`.
  - Aggregates the remaining FULL PASS gates into one machine-readable result.
  - Exits non-zero until direct GBrain canary, Claude canary, Remote MCP/OAuth fixture canary, scheduler burn-in, upstream PRs, doctor, and upgrade gates pass.
  - Treats runtime/pin drift as blocking, but local custom checkout drift as a warning once runtime and durable pins match upstream.
  - Runs the Remote MCP/OAuth fixture canary and requires proof that temporary fixture clients were revoked.
  - Requires every Railway-backed gate to prove the approved service target and blocks non-merged upstream PR states instead of downgrading closed/conflicted/unknown PR states to warnings.
  - Scans the full git diff and durable readiness artifacts for token/DB/API-key/client-secret patterns.
  - Runs the direct target-service GBrain live canary so health/stats/embed coverage cannot silently regress outside the full-pass gate.
  - Runs the direct GBrain canary after Remote MCP/Codex canaries, because those write canary pages that are not guaranteed to be embedded until a stale-embed job runs.
  - Runs a real target-service `gbrain doctor --json` gate; doctor warnings are blocking until the runtime status is `ok`.
- Updated `scripts/gbrain-live-canary.mjs`.
  - Submits a global `embed` job with `data:{stale:true}` before final stats/health.
  - This prevents other canary writes from leaving transient stale chunks that make global health evidence ambiguous.
- Opened upstream GBrain PR <https://github.com/garrytan/gbrain/pull/626>.
  - Fixes `embed --stale` for duplicate slugs across multiple sources by returning `page_id`/`source_id` from `listStaleChunks()` and upserting stale groups by page identity.
  - Runtime cherry-pick: `d050451df5852cc7414601e92b927469e374f75e`.
  - Runtime backup: `/data/backups/gbrain-source-patch/2026-05-04T23-43-22-626Z`.
  - Supervisor restarted cleanly from PID `95` to PID `8410`, `crashes_24h=0`.
- Added `scripts/gbrain-frontmatter-runtime-fix.mjs` and npm script `fix:gbrain-frontmatter-runtime`.
  - Defaults to dry-run plan mode.
  - Requires `GBRAIN_FRONTMATTER_FIX_APPROVED=openclaw-gbrain-frontmatter-fix` for runtime mutation or rollback.
  - Targets only syncable Markdown files under `/data/sources` on the approved OpenClaw service.
  - Avoids root-wide `gbrain frontmatter generate --fix`, which dry-ran too broadly.
  - Writes central backup manifests before rewrites.
- Extended `scripts/verify-gbrain-openclaw-readiness.sh` with scheduler validation, enabled-agent-wrapper count, and target-service verification for dead-job burn-in checks.

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
# checked at 2026-05-04T22:40:52Z
# status=WARN
# upstream sha/package: 058fe695756ed16e43916d907af3845338430156 / 0.26.7
# docker/verifier pins: 058fe695756ed16e43916d907af3845338430156
# runtime version 0.26.7 at 058fe695756ed16e43916d907af3845338430156
# warning only: local checkout /Users/arshya/gbrain remains dirty/custom at package 0.26.6
```

```bash
npm run upgrade:gbrain-runtime -- --json
# plan only; no runtime mutation
# checked at 2026-05-04T22:18:53Z
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
GBRAIN_RUNTIME_UPGRADE_APPROVED=openclaw-gbrain-runtime-upgrade \
  npm run upgrade:gbrain-runtime -- --execute --json
# checked at 2026-05-04T22:19:01Z
# status=EXECUTED
# old_sha=f79cad0d45147b35d429ce94e6c81be3716d552e
# old_version=gbrain 0.26.6
# new_sha=058fe695756ed16e43916d907af3845338430156
# new_version=gbrain 0.26.7
# backup_dir=/data/backups/gbrain-runtime-upgrade/2026-05-04T22-19-01-337Z
# doctor still status=warnings: resolver routing misses and source frontmatter warnings
```

```bash
railway up --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 \
  --detach \
  --message "harden gbrain runtime upgrade supervisor path"
# deployment afff717e-39e4-472b-acfd-98f9fd66c505
# status SUCCESS
# post-deploy runtime-readonly: GBrain 0.26.7, supervisor running pid=95
# last_start=2026-05-04T22:28:40.142Z, enabled_agent_wrapper_count=0
```

```bash
npm run canary:gbrain
# status=PASS
# pages, tags, links/backlinks/graph, timeline, raw data, chunks, search/query,
# versions, delete/restore, jobs, embeddings, stats, and health checks passed
```

```bash
npm run verify:gbrain -- --runtime-readonly
# checked at 2026-05-04T22:28:40Z after deployment afff717e-39e4-472b-acfd-98f9fd66c505
# OpenClaw 2026.5.2, GBrain 0.26.7
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
# Remaining blockers at that review: Claude quota, 24-48h scheduler burn-in,
# PR #619, PR #620, and approval-gated 0.26.7+ upgrade.
# Later sprint evidence fixed Claude Code canary and found/fixed PR #626,
# so the current blocker list is in the 2026-05-05T00:28:02Z gate snapshot.
```

```bash
/Users/arshya/.oracle/bin/oracle-pro review \
  --slug gbrain-astack-full-pass-pr626-final \
  --risk release \
  --intent release_gate \
  --run --json
# status=ok
# recommendationSummary=Keep PASS_WITH_CONCERNS/BLOCKED_FULL_PASS
# blockerCount=7
# Pro blocker corrections applied in this report/code pass:
# - non-merged upstream PR states are hard BLOCKED
# - runtime PR #626 cherry-pick is a BLOCKED currentness drift
# - Railway-backed gates assert approved service targets
# - Remote MCP service scope is explicit
# - Claude/Codex canaries independently verify final GBrain state
# - secret scan covers full diff plus durable artifacts
```

```bash
rg -n "gbrain_(?:cs|at|rt|code)_[A-Za-z0-9_-]+|postgres(?:ql)?://|sk-[A-Za-z0-9_-]+" \
  docs/gbrain-full-pass-readiness-sprint-2026-05-04.md \
  services/gbrain-remote-mcp scripts/gbrain-remote-mcp-canary.mjs
# superseded by secret_scan_full_diff_and_artifacts in the full gate
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
railway up --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service beab847a-12bb-499e-a44c-bf5d1982924f \
  --detach \
  --message "pin gbrain remote mcp to upstream 0.26.7"
# first attempt from repo root created deployment 60687c4e-72ae-49ee-a35e-cb1c83406b43
# status FAILED because it used the root OpenClaw Dockerfile and /health never became healthy
# previous remote deployment 20fbbae5-5abd-47d5-b95a-7745a14769e6 remained SUCCESS/active
```

```bash
cd services/gbrain-remote-mcp
railway up --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service beab847a-12bb-499e-a44c-bf5d1982924f \
  --detach \
  --message "pin gbrain remote mcp to upstream 0.26.7"
# deployment aa3baa40-a303-4bc0-890f-99a8120cbf69
# status SUCCESS
```

```bash
railway logs --service beab847a-12bb-499e-a44c-bf5d1982924f \
  --environment production --lines 80
# GBrain MCP Server v0.26.7
# Admin Token: suppressed in Railway logs
# DCR: disabled
```

```bash
npm run canary:gbrain-remote-fixture
# checked after remote deployment aa3baa40-a303-4bc0-890f-99a8120cbf69
# status=PASS
# exposed_tool_count=38
# missing/bad/expired token=401, revoked client=400, DCR/admin=404
# CORS default-deny, log-redaction, read-only write denial,
# read/write/search/version/delete/restore all pass
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
# checked at 2026-05-04T22:48:17Z through the full-pass gate runner
# status=PASS
# health_seen=true, search_seen=true, sentinel_seen=true, delete_restore_seen=true
# proves local Codex can use the same shared GBrain via MCP, not only list it
# note: delete/restore phase uses Codex noninteractive approval bypass, scoped
# by prompt to a single reversible canary slug and no shell/file edits.
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
# checked at 2026-05-04T23:21:33Z
# status=BLOCKED
# PASS: remote_mcp_oauth_fixture_canary
#   missing_token=401, bad_token=401, expired_token_denial=401
#   revoked_client_denial=400, dcr_disabled=404, admin_route_denial=404
#   CORS default-deny, log_redaction, read_only_write_denial,
#   read/write/search/version/delete/restore all PASS
#   oauth_fixture_clients_revoked=true
# PASS: openclaw_runtime_risk_logs
# PASS: codex_shared_gbrain_canary
#   health_seen=true, search_seen=true, sentinel_seen=true, delete_restore_seen=true
# WARN: update_flow_currentness runtime and durable pins match upstream, local checkout custom/dirty
# BLOCKED: upstream_pr_619_resolver open/mergeable
# BLOCKED: upstream_pr_620_http_auth open/mergeable
# BLOCKED: runtime_gbrain_doctor status=warnings
#   warning checks: resolver_health only
#   frontmatter_integrity fixed: audit ok=true,total=0
# BLOCKED: scheduler_dead_jobs_burn_in 3.3h/24h complete, no new dead jobs so far
# Claude gate evaluated separately with npm run canary:gbrain-claude:
# BLOCKED_QUOTA until 2am Europe/Zurich
```

```bash
railway ssh --project fbdb217b-060f-4f1e-8697-08a6288a19c4 \
  --environment production \
  --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 \
  '<runtime frontmatter audit summary>'
# before targeted fix:
# ok=false,total=4148
# MISSING_OPEN=4129,NESTED_QUOTES=19 across 21 sources
```

```bash
npm run fix:gbrain-frontmatter-runtime -- --json
# dry-run after rejecting broad root generation:
# sources_scanned=21,files_scanned=9142,issue_files=4148
# changed_files=4148,remaining_issue_files=0
# targets only syncable Markdown files with parseMarkdown audit errors
```

```bash
GBRAIN_FRONTMATTER_FIX_APPROVED=openclaw-gbrain-frontmatter-fix \
  npm run fix:gbrain-frontmatter-runtime -- --execute --json
# executed first pass:
# backup_dir=/data/backups/gbrain-frontmatter-fix/2026-05-04T23-15-19-110Z
# changed_files=4148,remaining_issue_files=0
```

```bash
GBRAIN_FRONTMATTER_FIX_APPROVED=openclaw-gbrain-frontmatter-fix \
  npm run fix:gbrain-frontmatter-runtime -- --execute --json
# executed two narrow YAML_PARSE cleanup passes:
# backup_dir=/data/backups/gbrain-frontmatter-fix/2026-05-04T23-17-46-319Z
# changed_files=5
# backup_dir=/data/backups/gbrain-frontmatter-fix/2026-05-04T23-18-58-677Z
# changed_files=2
```

```bash
gbrain frontmatter audit --json
# checked on runtime after cleanup
# ok=true,total=0,dirty_sources=[]

gbrain doctor --json
# status=warnings,health_score=95
# only remaining warning: resolver_health "37 issue(s): 0 error(s), 37 warning(s)"
```

```bash
# Runtime stale-embed blocker diagnosis, approved target service only.
gbrain embed --stale --dry-run --json
# before PR #626 runtime patch:
# [dry-run] Would embed 14 chunks across 10 pages

# Root cause evidence:
# duplicate slug examples included agents, log, identity, user, soul,
# with stale chunks on non-first page_ids such as 5133, 5577, 5172, 5553.
# Supervisor job before patch failed with:
# ON CONFLICT DO UPDATE command cannot affect row a second time
```

```bash
# Upstream fix opened and cherry-picked into runtime:
# PR: https://github.com/garrytan/gbrain/pull/626
# runtime HEAD after cherry-pick: d050451df5852cc7414601e92b927469e374f75e
# backup_dir=/data/backups/gbrain-source-patch/2026-05-04T23-43-22-626Z
# supervisor stopped pid=95 reason=drained
# supervisor started pid=8410 crashes_24h=0
```

```bash
# Post-patch stale embed via GBrain supervisor:
# submit_job embed stale=true -> job 1861 completed
# progress: done=10,total=10,embedded=14

gbrain embed --stale --dry-run --json
# [dry-run] Would embed 0 chunks (0 stale found)

npm run canary:gbrain
# status=PASS
# stats: chunk_count=36094, embedded_count=36094
# health after embed: embed_coverage=1, missing_embeddings=0
```

```bash
npm run canary:gbrain-codex
# status=PASS
# health_seen=true, search_seen=true, sentinel_seen=true, delete_restore_seen=true
# phase1_exit=0, phase2_exit=0
```

```bash
npm run canary:gbrain-claude
# status=PASS
# operations=get_page,put_page,search,delete_page,get_page_include_deleted,restore_page,get_page_restored
```

```bash
npm run verify:gbrain-full-pass-gates -- --json
# checked_at=2026-05-05T00:28:02Z
# status=BLOCKED
# PASS: remote_mcp_oauth_fixture_canary
#   service_id=beab847a-12bb-499e-a44c-bf5d1982924f verified=true
# PASS: claude_code_shared_gbrain_canary
#   final_state_verified_by_gbrain_get_page=true
# PASS: codex_shared_gbrain_canary
#   final_state_verified_by_gbrain_get_page=true
# PASS: direct_gbrain_live_canary
# PASS: openclaw_runtime_risk_logs
# PASS: secret_scan_full_diff_and_artifacts
# BLOCKED: upstream_pr_619_resolver open/mergeable
# BLOCKED: upstream_pr_620_http_auth open/mergeable
# BLOCKED: upstream_pr_626_stale_embed_source_scope open/mergeable
# BLOCKED: update_flow_currentness runtime sha d050451 differs from upstream 058fe695 due PR #626 cherry-pick
# BLOCKED: runtime_gbrain_doctor status=warnings (resolver_health only)
# BLOCKED: scheduler_dead_jobs_burn_in 4.4h/24h, no new dead jobs
```

```bash
# Upstream moved after the 00:28Z gate:
npm run check:gbrain-upstream -- --json
# checked_at=2026-05-05T00:31:59Z
# upstream_sha=9c2dc4cd544cd8013e0eee7a6ffb8536d3c2f13a
# upstream_package_version=0.26.8
# runtime_sha=d050451df5852cc7414601e92b927469e374f75e
# runtime_version=gbrain 0.26.7
# warnings: docker_pin_vs_upstream, verifier_pin_vs_upstream,
# local_origin_vs_upstream, runtime_sha_vs_upstream,
# runtime_version_vs_upstream_package, local_package_vs_upstream_package,
# local_worktree_clean
```

```bash
# PR branches were rebased onto upstream 0.26.8 / 9c2dc4c and force-with-lease pushed:
# PR #619 fix/resolver-routing-fixtures: c4fde03 -> 2a52cf4, base=9c2dc4c
# PR #620 fix/http-mcp-auth-errors: b3e4f25 -> 444fb2d, base=9c2dc4c
# PR #626 fix/embed-stale-source-scoping: 322a6eb -> 116d780, base=9c2dc4c
```

```bash
# Non-deployed custom runtime candidate prepared for explicit approval only:
# fork=ArshyaAI/gbrain
# branch=astack/full-pass-candidate-0.26.8
# head=bf3ce75
# composition=upstream 9c2dc4c + #619 + #620 + #626
# pushed=https://github.com/ArshyaAI/gbrain/tree/astack/full-pass-candidate-0.26.8
```

```bash
# Targeted upstream PR tests after rebase:
HOME=$(mktemp -d /tmp/gbrain-test-home.XXXXXX) \
  bun test test/check-resolvable.test.ts test/check-resolvable-cli.test.ts \
  test/doctor.test.ts test/routing-eval.test.ts test/routing-eval-cli.test.ts \
  --timeout 30000
# PR #619: 100 pass, 0 fail
bun run typecheck
# PR #619: pass

bun test test/oauth.test.ts test/e2e/serve-http-oauth.test.ts --timeout 30000
# PR #620: 42 pass, 26 skip because DATABASE_URL was not set, 0 fail
bun run typecheck
# PR #620: pass

bun test test/embed.serial.test.ts --timeout 30000
# PR #626: 12 pass, 0 fail
bun run typecheck
# PR #626: pass

# Combined candidate verification:
HOME=$(mktemp -d /tmp/gbrain-test-home.XXXXXX) \
  bun test test/check-resolvable.test.ts test/check-resolvable-cli.test.ts \
  test/doctor.test.ts test/routing-eval.test.ts test/routing-eval-cli.test.ts \
  test/oauth.test.ts test/e2e/serve-http-oauth.test.ts test/embed.serial.test.ts \
  --timeout 30000
# candidate branch astack/full-pass-candidate-0.26.8:
# 154 pass, 26 skip because DATABASE_URL was not set, 0 fail
bun run typecheck
# candidate branch: pass
```

```bash
# v0.26.8 migration v35 read-only safety audit on approved OpenClaw target:
# status=PASS
# non_exempt_public_tables_without_rls=0
# table_names=[]

npm run upgrade:gbrain-runtime -- --json
# status=PLAN
# current.sha=d050451df5852cc7414601e92b927469e374f75e
# current.version="gbrain 0.26.7"
# target_sha=9c2dc4cd544cd8013e0eee7a6ffb8536d3c2f13a
# target_is_upstream_master=true
# custom_runtime_cut_fetch_required=false
# fetch.source=origin
# fetch.ref=refs/heads/master
# pre_execute_readonly_checks include v35 RLS audit and a stop if non-exempt
# RLS-off public tables exist.

GBRAIN_RUNTIME_UPGRADE_SHA=bf3ce7595713ecd721bec849392b4acf6b036a8b \
  GBRAIN_RUNTIME_UPGRADE_FETCH_URL=https://github.com/ArshyaAI/gbrain.git \
  GBRAIN_RUNTIME_UPGRADE_REF=astack/full-pass-candidate-0.26.8 \
  npm run upgrade:gbrain-runtime -- --json
# status=PLAN
# target_is_upstream_master=false
# custom_runtime_cut_approval_required=openclaw-gbrain-custom-runtime-cut
# custom_runtime_cut_fetch_required=true
# custom_runtime_cut_approved=false
# custom_runtime_cut_fetch_declared=true
# fetch.source=https://github.com/ArshyaAI/gbrain.git
# fetch.ref=astack/full-pass-candidate-0.26.8
# no execution without both GBRAIN_RUNTIME_UPGRADE_APPROVED and
# GBRAIN_RUNTIME_CUSTOM_CUT_APPROVED approval phrases.

GBRAIN_RUNTIME_UPGRADE_APPROVED=openclaw-gbrain-runtime-upgrade \
  GBRAIN_RUNTIME_CUSTOM_CUT_APPROVED=openclaw-gbrain-custom-runtime-cut \
  GBRAIN_RUNTIME_UPGRADE_SHA=bf3ce7595713ecd721bec849392b4acf6b036a8b \
  npm run upgrade:gbrain-runtime -- --execute --json
# status=BLOCKED_CUSTOM_RUNTIME_FETCH_REQUIRED
# approved=true
# custom_runtime_cut_approved=true
# custom_runtime_cut_fetch_declared=false
# fetch.source=null
# fetch.ref=null
# no runtime mutation without explicit custom fetch URL and ref.

npm run verify:gbrain-full-pass-gates -- --skip-claude --skip-codex --skip-direct --skip-remote --json
# checked_at=2026-05-05T00:49:33Z
# status=BLOCKED
# PASS: openclaw_runtime_risk_logs
# PASS: secret_scan_full_diff_and_artifacts, diff_bytes_scanned=15039
# BLOCKED: upstream_pr_619_resolver open/mergeable
# BLOCKED: upstream_pr_620_http_auth open/mergeable
# BLOCKED: upstream_pr_626_stale_embed_source_scope open/mergeable
# BLOCKED: update_flow_currentness expected upstream 9c2dc4c / 0.26.8,
#          runtime d050451 / 0.26.7
# BLOCKED: runtime_gbrain_doctor status=warnings (resolver_health only)
# BLOCKED: scheduler_dead_jobs_burn_in 4.8h/24h, no new dead jobs

npm run verify:gbrain-full-pass-gates -- --json
# checked_at=2026-05-05T00:56:53Z
# status=BLOCKED
# PASS: remote_mcp_oauth_fixture_canary
#   missing_token=401, bad_token=401, expired_token_denial=401,
#   revoked_client_denial=400, DCR disabled=404, admin denied=404,
#   CORS default-deny/log-redaction/read-only write denial PASS,
#   exposed_tool_count=38, fixture clients revoked.
# PASS: claude_code_shared_gbrain_canary
#   get_page, put_page, search, delete_page, get_page_include_deleted,
#   restore_page, get_page_restored; final state verified by direct gbrain get_page.
# PASS: codex_shared_gbrain_canary
#   health/search/write/read/delete/restore; final state verified by direct gbrain get_page.
# PASS: direct_gbrain_live_canary
#   steps=33, chunk_count=36097, embedded_count=36097,
#   embed_coverage=1, missing_embeddings=0, brain_score=85.
# PASS: openclaw_runtime_risk_logs total/token/session/rate-limit=0
# PASS: secret_scan_full_diff_and_artifacts, diff_bytes_scanned=0
# BLOCKED: upstream_pr_619_resolver open/mergeable
# BLOCKED: upstream_pr_620_http_auth open/mergeable
# BLOCKED: upstream_pr_626_stale_embed_source_scope open/mergeable
# BLOCKED: update_flow_currentness expected upstream 9c2dc4c / 0.26.8,
#          runtime d050451 / 0.26.7
# BLOCKED: runtime_gbrain_doctor status=warnings (resolver_health only)
# BLOCKED: scheduler_dead_jobs_burn_in 4.9h/24h, no new dead jobs
```

## Rollback

OpenClaw target rollback:

1. Roll Railway service `openclaw-railway-template` back from `afff717e-39e4-472b-acfd-98f9fd66c505` to the previous known-good deployment `44b4da3f-da1e-46b0-b640-d4e42ba731d8`.
2. If a full scheduler revert is needed, roll further back to `8f4b1abf-15d0-4052-87e2-348e1555d282`.
3. Or restore the runtime backups created by `start-astack.sh` under:
   - `/data/.openclaw/cron/bin/direct-minions-scheduler.mjs.bak.astack-*`
   - `/data/.openclaw/cron/bin/openclaw-agent-job.sh.bak.astack-*`
4. To roll back only the GBrain runtime upgrade, use the recorded runtime backup:
   - `cd /data/gbrain && git checkout f79cad0d45147b35d429ce94e6c81be3716d552e`
   - `bun install --frozen-lockfile`
   - `/data/.bun/bin/gbrain init --migrate-only --json`
   - `/data/.bun/bin/gbrain apply-migrations --yes --non-interactive`
   - `/data/.bun/bin/gbrain doctor --json`
   - backup artifacts: `/data/backups/gbrain-runtime-upgrade/2026-05-04T22-19-01-337Z`
5. To roll back only the source-scoped stale-embed runtime patch:
   - `cd /data/gbrain && git reset --hard 058fe695756ed16e43916d907af3845338430156`
   - `/data/.bun/bin/gbrain jobs supervisor stop --json`
   - `/data/.bun/bin/gbrain jobs supervisor start --detach --json --allow-shell-jobs --cli-path /data/.bun/bin/gbrain`
   - `/data/.bun/bin/gbrain jobs supervisor status --json`
   - `/data/.bun/bin/gbrain embed --stale --dry-run --json`
   - backup artifacts: `/data/backups/gbrain-source-patch/2026-05-04T23-43-22-626Z`
6. To roll back the frontmatter source cleanup, restore the backup manifests in reverse order:
   - `GBRAIN_FRONTMATTER_FIX_APPROVED=openclaw-gbrain-frontmatter-fix npm run fix:gbrain-frontmatter-runtime -- --rollback=/data/backups/gbrain-frontmatter-fix/2026-05-04T23-18-58-677Z --json`
   - `GBRAIN_FRONTMATTER_FIX_APPROVED=openclaw-gbrain-frontmatter-fix npm run fix:gbrain-frontmatter-runtime -- --rollback=/data/backups/gbrain-frontmatter-fix/2026-05-04T23-17-46-319Z --json`
   - `GBRAIN_FRONTMATTER_FIX_APPROVED=openclaw-gbrain-frontmatter-fix npm run fix:gbrain-frontmatter-runtime -- --rollback=/data/backups/gbrain-frontmatter-fix/2026-05-04T23-15-19-110Z --json`

Remote MCP rollback:

- Roll Railway service `gbrain-remote-mcp` back from `aa3baa40-a303-4bc0-890f-99a8120cbf69` to previous known-good deployment `20fbbae5-5abd-47d5-b95a-7745a14769e6`.
- If remote MCP exposure must be stopped immediately, pause/remove only `gbrain-remote-mcp`; do not roll back the whole Railway project and do not touch `openclaw-railway-template`.

## Next Dogfood Commands

Safe read-only/full-canary commands from the runtime repo:

```bash
npm run verify:gbrain-full-pass-gates -- --json
npm run canary:gbrain
npm run canary:gbrain-remote-fixture
npm run canary:gbrain-codex
npm run canary:gbrain-claude
npm run check:gbrain-upstream -- --json
npm run upgrade:gbrain-runtime -- --json
```

Useful shared-GBrain queries:

```bash
gbrain search "gbrain openclaw readiness" --limit 5
gbrain query "What are the current GBrain/OpenClaw full-pass blockers?"
gbrain get "system/canaries/gbrain-codex-canary-2026-05-05"
gbrain get "system/canaries/gbrain-claude-code-canary-2026-05-05"
```

The runtime mutation command remains intentionally absent from this section. Use `npm run upgrade:gbrain-runtime -- --json` first; execution requires the approval phrases and rollback/canary plan described above.

## 2026-05-05 Upstream and Scheduler Recheck

User prompt: upstream has a new update and may have fixed the issue.

Fresh upstream result:

- `npm run check:gbrain-upstream -- --json`
  - upstream `garrytan/gbrain` master: `ee9ceb327a39b0c705ee945c6cfe821de11d34ed`
  - upstream package: `0.27.0`
  - runtime remains `d050451df5852cc7414601e92b927469e374f75e` / `gbrain 0.26.7`
  - docker/verifier pins remain `058fe695756ed16e43916d907af3845338430156`
- `npm run verify:gbrain-full-pass-gates -- --skip-claude --skip-codex --skip-direct --skip-remote --json`
  - status: `BLOCKED`
  - PR #619, #620, and #626 remain open and mergeable, not consumed by upstream master.
  - runtime doctor remains `warnings` because resolver health still reports 37 routing warnings.
  - risk logs are clean for token/session/rate-limit churn.
  - scheduler burn-in failed because a new dead shell job appeared after cutoff.

Upstream PR maintenance:

- Rebased and pushed the three existing upstream PR branches onto `ee9ceb327a39b0c705ee945c6cfe821de11d34ed` / `0.27.0`.
- #619 `fix/resolver-routing-fixtures`: new head `7026ea2e851c15e9a1489b6df50c5b0d485d2c44`; verification: routing eval `58/58`, resolver doctor `ok`, targeted tests pass, typecheck pass.
- #620 `fix/http-mcp-auth-errors`: new head `c6a3f9548d88b99eb72a2ed0787207ae98606cbe`; verification: OAuth + HTTP MCP tests pass with DB-backed tests skipped because `DATABASE_URL` is not set, typecheck pass.
- #626 `fix/embed-stale-source-scoping`: new head `2ebb917cf703e73994e8fe9d599b9f7b49ed7994`; verification: embed serial tests pass, typecheck pass.

New scheduler blocker:

- `npm run verify:gbrain -- --dead-jobs-readonly`
  - target verified: `openclaw-railway-template` / `6f333a2b-07d9-4219-8531-3b96fbc6a2f9`
  - new dead job: `1894`, started `2026-05-05T01:17:05.573Z`
  - command data: `["bash","/data/.openclaw/cron/bin/x-bookmarks-daily.sh"]`
  - root cause class: X/Twitter API credits depleted, not OpenClaw model cooldown.
- Runtime manifest shows `x-bookmarks-daily` enabled at `17 3 * * *` Europe/Zurich through `gbrain-submit-shell-job.sh`.
- Current runtime script fails hard when `x-collector.mjs collect-bookmarks` receives `CreditsDepleted`, causing GBrain shell retries and a `DEAD` job.

AstACK-owned local fix prepared:

- Added `patches/astack-shell-job-runner.sh`.
  - Preserves normal successful shell-job output.
  - Preserves hard failures for non-quota errors.
  - Converts known X/Twitter credits-depleted failures into `skipped_external_quota` with sanitized diagnostic tail and exit `0`, preventing noisy GBrain retries/dead jobs while keeping the quota condition visible.
- Added `patches/gbrain-submit-shell-job.sh`.
  - Submits shell jobs through `astack-shell-job-runner.sh` when the runner is installed.
  - Falls back to the original direct script invocation if the runner is absent.
- Updated `patches/start-astack.sh` to install both shell-job patches at boot.
- Added `scripts/test-gbrain-shell-job.sh` and `npm run test:gbrain-shell-job`.

Verification:

```bash
npm run test:gbrain-shell-job
# gbrain shell job tests passed

npm run test:openclaw-agent-job
# openclaw-agent-job tests passed

node --check patches/direct-minions-scheduler.mjs
bash -n patches/start-astack.sh patches/astack-shell-job-runner.sh patches/gbrain-submit-shell-job.sh scripts/test-gbrain-shell-job.sh
```

Runtime deployment status:

- Deployed after explicit approval phrase: `deploy den shell-job quota guard`.
- Command: `railway up --project fbdb217b-060f-4f1e-8697-08a6288a19c4 --environment production --service 6f333a2b-07d9-4219-8531-3b96fbc6a2f9 --detach --message "deploy astack shell-job quota guard"`.
- Deployment: `9a87eb62-612d-4bdf-9ed7-b99c495edfdc`, status `SUCCESS`, created `2026-05-05T05:54:32.480Z`.
- Pre-deploy target check: service `openclaw-railway-template` deployment `afff717e-39e4-472b-acfd-98f9fd66c505` was `SUCCESS`; current token/session/rate-limit risk logs were `0`; local shell-job and OpenClaw-agent job tests passed.
- Live install proof:
  - `/data/.openclaw/cron/bin/astack-shell-job-runner.sh` installed at `2026-05-05T05:55`, executable.
  - `/data/.openclaw/cron/bin/gbrain-submit-shell-job.sh` installed at `2026-05-05T05:55`, executable.
  - Runner contains `skipped_external_quota` / `x_api_credits_depleted`.
  - Submit wrapper routes shell jobs through `astack-shell-job-runner.sh`.
  - Scheduler validates `enabled_cron=12`, `disabled_cron=7`, enabled OpenClaw-agent wrappers `0`.
- Runtime current risk logs after deploy: deployment `9a87eb62-612d-4bdf-9ed7-b99c495edfdc` `SUCCESS`, total lines `56`, token mismatch `0`, sessions/store `0`, rate-limit `0`.
- End-to-end quota-guard canary:
  - Submitted fake shell job `1941` through live `gbrain-submit-shell-job.sh`.
  - Job data used argv `["bash","/data/.openclaw/cron/bin/astack-shell-job-runner.sh","/tmp/astack-quota-guard-canary.sh"]`.
  - Job completed, not dead: started `2026-05-05T05:58:46.003Z`, finished `2026-05-05T05:58:46.180Z`.
  - Result stderr included `event:"skipped_external_quota"`, `class:"x_api_credits_depleted"`, `original_exit:1`.
- Gate after deploy:
  - `GBRAIN_FULL_PASS_DEAD_JOB_CUTOFF=2026-05-05T05:55:53Z npm run verify:gbrain-full-pass-gates -- --skip-claude --skip-codex --skip-direct --skip-remote --json`
  - status `BLOCKED`, not `FAIL`; scheduler burn-in `0.17h/24h`, no new dead jobs after cutoff.
  - New automated gate `runtime_shell_quota_guard`: `PASS`.
  - Gate evidence: approved service ID matched, runner/submit scripts executable, submit routes through runner, `x-bookmarks-daily` is enabled and uses the submit wrapper, and canary job `1941` completed through the runner with `skipped_external_quota` / `x_api_credits_depleted`.
- Post-deploy direct GBrain live canary:
  - Command: `npm run canary:gbrain`
  - Status: `PASS`
  - Covered put/get/tag/search/query/versions/delete/restore, links/backlinks/graph, timeline, raw data, chunks, jobs, explicit embed job, global stale embed job, stats, and health.
  - Embed evidence: `chunk_count=36097`, `embedded_count=36097`, `missing_embeddings=0`, `embed_coverage=1`, `brain_score=85`.
- Post-deploy Remote MCP fixture canary:
  - Command: `npm run canary:gbrain-remote-fixture`
  - Status: `PASS`
  - Covered missing token `401`, bad token `401`, CORS default-deny, DCR disabled `404`, admin denial `404`, expired token `401`, revoked client denial `400`, log redaction, read-only write denial, tools list, read/write/search/version/delete/restore, and fixture client revocation.
  - Remote target verified: `gbrain-remote-mcp` / `beab847a-12bb-499e-a44c-bf5d1982924f`.
- Expected impact: future X/Twitter credits-depleted collector runs become recorded skips instead of GBrain `DEAD` shell jobs; real script failures still fail.
- Rollback: redeploy previous Railway deployment `afff717e-39e4-472b-acfd-98f9fd66c505` for `openclaw-railway-template`, or restore `/data/.openclaw/cron/bin/gbrain-submit-shell-job.sh` and `/data/.openclaw/cron/bin/astack-shell-job-runner.sh` from boot backups created by `start-astack.sh`.

## Remaining FULL PASS Gates

1. Complete 24-48h scheduler burn-in from cutoff `2026-05-05T05:55:53Z`. Latest gate at `2026-05-05T06:05:47Z` reports `0.17h/24h` complete and no new dead jobs after cutoff.
2. Land or consume upstream GBrain PR #619 so runtime doctor can move from shipped resolver warnings to `ok`.
3. Land or consume upstream GBrain PR #620 so invalid/expired MCP bearer tokens return clean OAuth auth failures from upstream, not only from the astack wrapper.
4. Land or consume upstream GBrain PR #626 so runtime source-scoped stale embedding is not a custom cherry-pick.
5. Upgrade/pin the approved runtime and durable astack pins against upstream `0.27.0` / `ee9ceb327a39b0c705ee945c6cfe821de11d34ed`, after deciding whether to wait for PR #619/#620/#626 upstream consumption or create an explicitly accepted custom combined runtime cut. The custom cut path still requires both approval phrases and the explicit `ArshyaAI/gbrain` fetch URL/ref before runtime mutation.
6. Decide whether to update the local custom checkout `/Users/arshya/gbrain` from package `0.26.6` to `0.27.0`; it is intentionally preserved because it is a custom dirty branch.
