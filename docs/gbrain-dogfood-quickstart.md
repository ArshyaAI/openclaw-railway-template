# GBrain Dogfood Quickstart

Status: `DOGFOOD_READY_CUSTOM_CUT`
Date: 2026-05-06

This guide is the practical operating loop for using the shared GBrain setup now.
It is not a FULL PASS certificate. Upstream-clean FULL PASS still waits on the
upstream PRs and currentness cleanup recorded in
`docs/gbrain-full-pass-readiness-sprint-2026-05-04.md`.

Guide canary:

- `system/docs/gbrain-dogfood-quickstart-canary-2026-05-05-104428`
- Verified local CLI write, read, search, soft-delete visibility, and restore.

## Mental Model

GBrain is the shared memory layer.

| Surface | What it is for | Current dogfood posture |
| --- | --- | --- |
| Local `gbrain` CLI | Fast direct read/write/search/query from the workstation | `gbrain 0.27.0` custom cut |
| OpenClaw stdio MCP | Railway OpenClaw agents calling GBrain tools inside the target runtime | Canary passed |
| Remote MCP/OAuth | Local/external agents connecting to the same shared brain over HTTP MCP | Canary passed with auth guardrails |
| Local Codex | Local agent can read/write/search shared GBrain via the supported setup | Canary passed |
| Local Claude Code | Claude Code can use the same shared GBrain | Canary passed |
| Supabase/Postgres | Shared durable data layer | Runtime doctor healthy |
| Twilio/AStack Voice | Phone-call capture into GBrain via Twilio speech gather | Capture canary passed; realtime conversation remains disabled until the WebSocket path is trusted |

Keep these layers separate:

- GBrain tool repo: runtime `/data/gbrain`
- Brain/content state: `/data/brain`, `/data/sources`, and Supabase/Postgres
- Runtime template repo: `/Users/arshya/Desktop/AI.nosync/openclaw-railway-template`
- Local source checkout: `/Users/arshya/gbrain` (currently intentionally not the authority)

## Safety Rules

- Do not store secrets in GBrain.
- Do not paste OAuth callback URLs, API keys, cookies, Railway variables, database
  URLs, or bearer tokens into pages.
- Use summaries and decisions, not raw private dumps.
- Keep NIKIN main production out of this workflow unless explicitly scoped.
- Treat Remote MCP token creation/revocation as an admin operation; never put the
  token value in docs, commits, logs, or screenshots.

## OAuth/API Key Policy

Current rule:

- Use `openai-codex/*` OAuth for OpenClaw/AStack agent text and reasoning wherever
  that path exists.
- Do not silently route agent text work through `openai/gpt-*` API-key models when
  a matching Codex OAuth model is available.
- Keep API keys for paths that currently require them: Twilio/OpenAI Realtime,
  embeddings, and non-OpenAI providers such as Gemini or Anthropic when selected.

Live OpenClaw routing after the 2026-05-05 deploy:

- Default model: `openai-codex/gpt-5.5`
- `GPT` alias: `openai-codex/gpt-5.4`
- Scheduled agent wrapper default: `openai-codex/gpt-5.4`
- Fallback: `google/gemini-2.5-pro`

## Core Commands

Health and version:

```bash
gbrain version
gbrain health
gbrain doctor --fast --json
```

Find context:

```bash
gbrain search "treeki v2" --limit 10
gbrain query "What are the current GBrain/OpenClaw blockers?" --limit 8
gbrain query "Find the latest evidence about remote MCP dogfood readiness" --detail medium
```

Write a durable note:

```bash
gbrain put "worklog/$(date +%F)/treeki-next-step" --content "$(cat <<'MD'
---
type: worklog
tags: [treeki, gbrain, dogfood]
---

# Treeki Next Step

Decision:
- ...

Evidence:
- ...

Next:
- ...
MD
)"
```

Read it back:

```bash
gbrain get "worklog/$(date +%F)/treeki-next-step"
gbrain search "Treeki Next Step" --limit 5
```

Version and recovery:

```bash
SLUG="worklog/$(date +%F)/treeki-next-step"
gbrain history "$SLUG"
gbrain delete "$SLUG"
gbrain get "$SLUG" --include-deleted
gbrain call restore_page "{\"slug\":\"$SLUG\"}"
```

Tags, links, and timeline:

```bash
gbrain tag "worklog/$(date +%F)/treeki-next-step" treeki
gbrain tags "worklog/$(date +%F)/treeki-next-step"
gbrain link "worklog/$(date +%F)/treeki-next-step" "system/gbrain/openclaw-readiness" --type relates_to
gbrain backlinks "system/gbrain/openclaw-readiness"
gbrain timeline-add "worklog/$(date +%F)/treeki-next-step" "$(date +%F)" "Picked next Treeki/GBrain dogfood step."
gbrain timeline "worklog/$(date +%F)/treeki-next-step"
```

Stats and coverage:

```bash
gbrain stats
gbrain orphans --count
gbrain jobs stats
```

## Voice/Twilio Capture

Twilio is live as a capture path, not yet as a trusted realtime conversation path.

What works now:

- Incoming/outgoing Twilio calls reach the AStack Voice service.
- Voice runs in `gather` mode.
- Speech is written to `voice-notes/YYYY/<slug>` in GBrain.
- A 2026-05-05 signed Twilio webhook canary wrote and retrieved
  `voice-notes/2026/2026-05-05-twilio-voice-689b95a5b9`.

Use it for short captures:

```text
Call AStack Voice and say one concise note, decision, or follow-up.
Then ask AStack: "Nutze GBrain. Finde meine letzte Voice Note und mach daraus
Tasks, Decisions und eine Timeline."
```

Do not treat voice as a full realtime assistant yet. The OpenAI Realtime API key
canary is green, but the public WebSocket/realtime call path still needs a
separate trust pass before it should replace gather capture.

## Daily Operating Loop

Morning focus:

```bash
gbrain query "Based on recent NIKIN, Treeki, astack, and GBrain state, what should I focus on today?" --limit 10
```

Before starting a task:

```bash
gbrain query "Give me the relevant context, decisions, risks, and next steps for: <task>" --detail medium
```

During the task, store decisions:

```bash
gbrain put "decisions/$(date +%F)/<short-topic>" --content "$(cat <<'MD'
---
type: decision
tags: [nikin, treeki]
---

# <Decision Title>

Decision:
- ...

Why:
- ...

Evidence:
- ...

Follow-up:
- ...
MD
)"
```

After an agent finishes:

```bash
gbrain put "agent-runs/$(date +%F)/<agent>-<topic>" --content "$(cat <<'MD'
---
type: agent-run
tags: [codex, claude, openclaw, gbrain]
---

# Agent Run: <topic>

Goal:
- ...

Result:
- ...

Files or deploys:
- ...

Verification:
- ...

Remaining risks:
- ...
MD
)"
```

End of day:

```bash
gbrain query "Summarize today's useful GBrain/OpenClaw/NIKIN/Treeki learnings and unresolved blockers." --limit 12
```

## Good Queries

Prefer concrete, evidence-seeking prompts:

- "What are the current blockers for upstream-clean GBrain FULL PASS?"
- "Find recent decisions about Remote MCP/OAuth security posture."
- "What commands prove OpenClaw can use GBrain?"
- "What did we decide about Treeki v2 foundation and NIKIN AI system vision?"
- "Which pages mention scheduler burn-in or dead shell jobs?"

Avoid vague prompts:

- "Tell me everything."
- "What is going on?"
- "Make me productive."

If retrieval feels noisy, add constraints:

```bash
gbrain query "Only use pages from the last readiness sprint. What is still blocked?" --limit 6 --detail low
gbrain query "Remote MCP OAuth canary evidence" --no-expand --limit 8
```

## Agent Handoff Pattern

When starting Codex, Claude Code, or OpenClaw work, include an explicit GBrain
instruction:

```text
Before planning, query shared GBrain for relevant context on <topic>.
Use the evidence you find, then write back a short page under
agent-runs/YYYY-MM-DD/<agent>-<topic> with result, files changed, verification,
and remaining risks. Do not store secrets.
```

To verify the agent really used GBrain:

1. Create a sentinel page:

```bash
gbrain put "system/sentinels/$(date +%F)-agent-gbrain-check" --content "$(cat <<'MD'
---
type: sentinel
tags: [gbrain, agent-check]
---

Sentinel phrase: shared-gbrain-agent-check
Instruction: mention this exact phrase only if you read this page from GBrain.
MD
)"
```

2. Ask the agent to read it from GBrain and report the sentinel phrase.
3. Search for the follow-up write:

```bash
gbrain search "shared-gbrain-agent-check" --limit 10
```

## Remote MCP/OAuth Posture

Remote MCP is for local or external agents that need the shared live brain.
Current policy:

- Auth required.
- Missing/bad/expired bearer tokens fail cleanly.
- DCR defaults off.
- CORS defaults deny.
- Admin-token printing defaults off.
- Read-only client write denial is canaried.

Do not create new public clients, tunnels, or relaxed CORS rules without a new
written guardrail pass.

## What To Put In GBrain

Good:

- Decisions and why they were made
- Evidence summaries and command outputs without secrets
- Readiness status, blocker lists, rollback notes
- Meeting-derived action items
- Agent run summaries
- Treeki/NIKIN system design notes

Not good:

- Raw secrets or callback URLs
- Database URLs, tokens, cookies, private keys
- Huge unfiltered dumps when a short summary is enough
- Unverified claims without source/evidence
- Private personal data unless explicitly allowlisted

## Current Full-Pass Caveat

Use GBrain now for dogfooding. Do not call it upstream-clean FULL PASS until:

- PR #619 is merged/consumed upstream.
- PR #620 is merged/consumed upstream.
- PR #626 is merged/consumed upstream.
- Runtime and Remote MCP move back from the custom SHA to upstream-clean GBrain.
- Scheduler burn-in remains clean. Latest refreshed gate:
  `29.0h/24h` complete at `2026-05-06T10:54Z`, with no new dead jobs after the
  cutoff.
- Fresh risk logs and canaries stay clean.
