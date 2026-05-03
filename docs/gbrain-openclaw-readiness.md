# GBrain / OpenClaw Readiness Runbook

Status: `READ_ONLY_BLOCKED`
Date: 2026-05-03

This runbook keeps GBrain/OpenClaw readiness checks reproducible without
mutating Railway production state.

## Scope

Target Railway service:

- Project: `ravishing-enjoyment`
- Project ID: `fbdb217b-060f-4f1e-8697-08a6288a19c4`
- Environment: `production`
- Environment ID: `614198f2-f7ed-4756-ae83-e0dd23943c9d`
- Service: `openclaw-railway-template`
- Service ID: `6f333a2b-07d9-4219-8531-3b96fbc6a2f9`

Forbidden non-target service:

- `NIKIN - MAIN OC INSTANCE [PRODUCTION]`
- Service ID: `63b84308-25d7-4b03-9c23-4d0d7239728f`

Do not run deploys, restarts, variable edits, DB migrations, cron changes,
OAuth changes, tunnel changes, webhook changes, or OpenClaw agent canaries
without an explicit approval note and rollback plan.

## Source Of Truth

GBrain upstream is authoritative:

- Repository: https://github.com/garrytan/gbrain
- Last inspected upstream commit: `3c032d79ecccff8d87a5b601a34b9e7cb8194dd7`
- Upstream package version at that commit: `0.26.0`
- Upstream OpenClaw plugin manifest version at that commit: `0.25.1`

Do not use the public npm package named `gbrain` as authority. Upstream issue
#505 identifies that package name as a dependency-confusion risk.

## Current Readiness Snapshot

The latest read-only audit did not prove daily-dogfood readiness.

Known blockers:

- Runtime GBrain is behind upstream: runtime `0.22.4`, upstream `0.26.0`.
- Local GBrain is behind and schema-risky: local `0.18.2`, DB schema `30`,
  local latest schema `24`.
- OpenClaw runtime is behind npm latest: runtime `2026.4.24`, latest observed
  `2026.5.2`.
- AlphaClaw `0.9.12` depends on `openclaw: 2026.4.24`, so the OpenClaw pin is
  intentional until compatibility is proven.
- OpenClaw runtime has no configured MCP servers and no loaded upstream `gbrain`
  plugin path.
- Recent logs show `token_mismatch` websocket loops and repeated
  `sessions/store` rotations.
- Latest runtime read-only check shows one dead `shell` job in the last 24h
  (`gbrain jobs list --status dead --limit 5` reported job `1451`, created
  `2026-05-03T11:15:00`).
- Remote MCP auth posture cannot be verified on runtime GBrain `0.22.4`
  because `gbrain auth` is unavailable.
- Dirty/untracked Markdown indexing proof and OpenClaw agent canary require
  explicit production approval.

Positive evidence:

- Target Railway deployment is `SUCCESS`.
- The broader read-only audit, not this lightweight verifier alone, recorded
  runtime `gbrain doctor --json` warnings with health score `95`.
- DB, pgvector, RLS, embeddings, graph coverage, supervisor, jobs, and
  direct-minions scheduler have broader read-only pass evidence.
- No production mutation was performed during the audit.

## Safe Local Verification

Run:

```bash
npm run verify:gbrain -- --help
npm run verify:gbrain -- --local
npm run verify:gbrain -- --runtime-readonly
GBRAIN_VERIFY_SINCE=10m npm run verify:gbrain -- --railway-current
```

The local mode reads this repository, local CLI versions, and safe health
summaries. It does not inspect Railway variables and does not mutate local
GBrain sources.

The runtime-readonly mode SSHes into only the target service and prints
redacted diagnostics: versions, safe OpenClaw config metadata, config
validation, MCP/plugin discovery, fast GBrain health, job supervisor status,
dead-job summary, cron file names, and the direct-minions process count. It
does not print environment variables or token values.

The railway-current mode checks the same target service and summarizes recent
risk logs from `GBRAIN_VERIFY_SINCE` (default `10m`). Use it to distinguish old
historical blockers from newly recurring runtime issues.

## Safe Railway Verification

Run only when Railway CLI is authenticated:

```bash
GBRAIN_VERIFY_TMPDIR=/private/tmp npm run verify:gbrain -- --railway
```

The Railway mode creates a temporary CLI link under the configured temp
directory, targets only service ID `6f333a2b-07d9-4219-8531-3b96fbc6a2f9`, and
reads service status, deployment history, and filtered runtime logs. It refuses
the forbidden service ID and does not read variables.

The `GBRAIN_VERIFY_TMPDIR` prefix keeps Railway's temporary link inside a
Codex-writable scratch directory on macOS. In a normal shell this can be omitted
if `/tmp` and your default temp directory are writable.

## Upgrade Gate

Do not bump `overrides.openclaw` or runtime GBrain in production directly.

Minimum gate before upgrade:

1. Build in staging or an equivalent disposable container.
2. Verify the AlphaClaw process patch still applies.
3. Verify `openclaw config validate`, `openclaw skills list`, and
   `openclaw mcp list`.
4. Verify GBrain doctor, schema, embeddings, graph, sources, jobs, and sync.
5. Verify no fresh `token_mismatch` loop or session-store storm appears.
6. Run a real OpenClaw-to-GBrain canary only after approval.
7. Record rollback to deployment `a55d9794-0ecb-4ff9-8bd4-ce9462381c41`.

## PASS Criteria

Only call the system ready when all of these have evidence:

- GBrain upstream commit and version are pinned.
- Tool repo, content brain, local repo, runtime repo, and Railway volume state
  are explicitly separated.
- Runtime GBrain is current or pinned with a documented compatibility reason.
- Local GBrain is not schema-risky against the active DB.
- OpenClaw can call GBrain in the intended agent flow.
- GBrain doctor is green, or all warnings are documented and accepted.
- Sources, sync, dirty/untracked Markdown indexing, embeddings, graph, links,
  timeline, jobs, and queries work with evidence.
- Direct-minions scheduler is active and not causing OpenClaw session churn.
- Remote MCP/security posture matches upstream guidance before exposure.
- No secrets are printed or committed.
- The NIKIN production service remains untouched.
