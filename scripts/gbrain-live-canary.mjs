#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';

const target = {
  project: 'fbdb217b-060f-4f1e-8697-08a6288a19c4',
  environment: 'production',
  environmentId: '614198f2-f7ed-4756-ae83-e0dd23943c9d',
  service: '6f333a2b-07d9-4219-8531-3b96fbc6a2f9',
  serviceName: 'openclaw-railway-template',
};

const forbiddenService = '63b84308-25d7-4b03-9c23-4d0d7239728f';

if (target.service === forbiddenService) {
  console.error(`REFUSING forbidden service id: ${forbiddenService}`);
  process.exit(2);
}

function shellQuote(value) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

const remoteCanary = String.raw`
const { execFileSync } = require("node:child_process");

const env = {
  ...process.env,
  HOME: "/data",
  GBRAIN_HOME: "/data",
  BRAIN_REPO: "/data/brain",
  BUN_INSTALL: "/data/.bun",
  PATH: "/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
};

const sentinel = "GBRAIN_CANARY_2026_05_04_OC_RAILWAY_SUPABASE";
const mainSlug = "system/canaries/gbrain-live-canary-2026-05-04";
const linkedSlug = "system/canaries/gbrain-linked-target-2026-05-04";
const sourceName = "codex-live-canary";
const evidence = [];

function parseJsonOutput(output) {
  const text = String(output || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;
    try {
      return JSON.parse(text.slice(i));
    } catch {}
  }
  throw new Error("Could not parse gbrain JSON output: " + text.slice(0, 300));
}

function call(tool, params = {}, timeout = 180000) {
  const output = execFileSync(
    "/data/.bun/bin/gbrain",
    ["call", tool, JSON.stringify(params)],
    { env, encoding: "utf8", timeout, maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] },
  );
  return parseJsonOutput(output);
}

function pass(name, result, detail = {}) {
  evidence.push({ name, pass: true, detail: { ...detail, sample: summarize(result) } });
}

function fail(name, message, result) {
  evidence.push({ name, pass: false, detail: { message, sample: summarize(result) } });
}

function summarize(value) {
  if (Array.isArray(value)) return { type: "array", count: value.length, first: value[0] ? small(value[0]) : null };
  return small(value);
}

function small(value) {
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).slice(0, 12)) {
    const current = value[key];
    if (typeof current === "string") out[key] = current.length > 140 ? current.slice(0, 140) + "..." : current;
    else if (Array.isArray(current)) out[key] = { type: "array", count: current.length };
    else if (current && typeof current === "object") out[key] = { type: "object", keys: Object.keys(current).slice(0, 8) };
    else out[key] = current;
  }
  return out;
}

function expect(name, result, predicate, detail = {}) {
  if (predicate(result)) pass(name, result, detail);
  else fail(name, "predicate failed", result);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const linkedContent = [
  "---",
  "title: GBrain Canary Link Target 2026-05-04",
  "type: note",
  "tags:",
  "  - gbrain-canary",
  "  - openclaw-live",
  "---",
  "",
  "# GBrain Canary Link Target 2026-05-04",
  "",
  "This page is a synthetic live canary for GBrain on OpenClaw/Railway/Supabase.",
  "",
  sentinel,
].join("\n");

const mainContent = [
  "---",
  "title: GBrain Live Canary 2026-05-04",
  "type: note",
  "tags:",
  "  - gbrain-canary",
  "  - openclaw-live",
  "  - astack",
  "---",
  "",
  "# GBrain Live Canary 2026-05-04",
  "",
  "This validates the actual deployed stack: OpenClaw on Railway, Supabase-backed GBrain, and the current upstream-aligned runtime.",
  "",
  "Related page: [[system/canaries/gbrain-linked-target-2026-05-04]].",
  "",
  "Timeline: 2026-05-04 - Live canary confirms GBrain is callable, indexed, queryable, linked, and supervised.",
  "",
  sentinel,
].join("\n");

const mainContentUpdated = mainContent + "\n\nVersion history update marker: " + sentinel + "\n";

expect("put linked page", call("put_page", { slug: linkedSlug, content: linkedContent }), (r) => r && r.slug === linkedSlug);
expect("put main page", call("put_page", { slug: mainSlug, content: mainContent }), (r) => r && r.slug === mainSlug);
expect("update main page for version history", call("put_page", { slug: mainSlug, content: mainContentUpdated }), (r) => r && r.slug === mainSlug);
expect("get main page", call("get_page", { slug: mainSlug }), (r) => r && String(r.compiled_truth || r.content || "").includes(sentinel));
expect("add tag", call("add_tag", { slug: mainSlug, tag: "codex-live-canary" }), (r) => r !== null);
expect("get tags", call("get_tags", { slug: mainSlug }), (r) => Array.isArray(r) && r.includes("codex-live-canary"));
expect("add link", call("add_link", { from: mainSlug, to: linkedSlug, link_type: "validates", context: "GBrain live canary" }), (r) => r !== null);
expect("get links", call("get_links", { slug: mainSlug }), (r) => Array.isArray(r) && r.some((x) => x.to_slug === linkedSlug || x.to === linkedSlug));
expect("get backlinks", call("get_backlinks", { slug: linkedSlug }), (r) => Array.isArray(r) && r.some((x) => x.from_slug === mainSlug || x.from === mainSlug));
expect("traverse graph", call("traverse_graph", { slug: mainSlug, depth: 1, link_type: "validates", direction: "out" }), (r) => Array.isArray(r) && r.length >= 1);
expect("add timeline", call("add_timeline_entry", {
  slug: mainSlug,
  date: "2026-05-04",
  summary: "Live GBrain canary passed",
  detail: sentinel,
  source: sourceName,
}), (r) => r !== null);
expect("get timeline", call("get_timeline", { slug: mainSlug }), (r) => Array.isArray(r) && r.some((x) => String(x.detail || x.summary || "").includes(sentinel)));
expect("put raw data", call("put_raw_data", {
  slug: mainSlug,
  source: sourceName,
  data: { sentinel, stack: ["OpenClaw", "Railway", "Supabase", "GBrain"], checked_at: new Date().toISOString() },
}), (r) => r !== null);
expect("get raw data", call("get_raw_data", { slug: mainSlug, source: sourceName }), (r) => Array.isArray(r) ? r.some((x) => JSON.stringify(x).includes(sentinel)) : JSON.stringify(r).includes(sentinel));
expect("get chunks", call("get_chunks", { slug: mainSlug }), (r) => Array.isArray(r) && r.length >= 1);
expect("keyword search", call("search", { query: sentinel, limit: 5 }), (r) => Array.isArray(r) && r.some((x) => x.slug === mainSlug || x.slug === linkedSlug));
expect("hybrid query", call("query", { query: sentinel, limit: 5, expand: false, detail: "medium" }, 240000), (r) => Array.isArray(r) && r.some((x) => x.slug === mainSlug || x.slug === linkedSlug));
expect("resolve slugs", call("resolve_slugs", { partial: "gbrain-live-canary-2026-05-04" }), (r) => Array.isArray(r) && r.includes(mainSlug));
expect("get versions", call("get_versions", { slug: mainSlug }), (r) => Array.isArray(r) && r.length >= 1);
expect("soft delete linked", call("delete_page", { slug: linkedSlug }), (r) => r !== null);
expect("include deleted linked", call("get_page", { slug: linkedSlug, include_deleted: true }), (r) => r && !!r.deleted_at);
expect("restore linked", call("restore_page", { slug: linkedSlug }), (r) => r !== null);
expect("get restored linked", call("get_page", { slug: linkedSlug }), (r) => r && !r.deleted_at && String(r.compiled_truth || r.content || "").includes(sentinel));
expect("job list", call("list_jobs", { limit: 5 }), (r) => Array.isArray(r));

const job = call("submit_job", { name: "embed", data: { slugs: [mainSlug, linkedSlug] }, max_attempts: 1, timeout_ms: 120000 });
expect("submit embed job", job, (r) => r && typeof r.id === "number");
if (job && typeof job.id === "number") {
  let observed = null;
  for (let i = 0; i < 150; i += 1) {
    observed = call("get_job", { id: job.id });
    if (observed && ["completed", "failed", "dead", "cancelled"].includes(observed.status)) break;
    sleep(1000);
  }
  expect("get embed job", observed, (r) => r && r.id === job.id && r.status === "completed");
  expect("get embed job progress", call("get_job_progress", { id: job.id }), (r) => r && r.id === job.id);
  expect("main chunks embedded after job", call("get_chunks", { slug: mainSlug }), (r) => Array.isArray(r) && r.some((x) => x.embedded_at || x.embedding));
  expect("linked chunks embedded after job", call("get_chunks", { slug: linkedSlug }), (r) => Array.isArray(r) && r.some((x) => x.embedded_at || x.embedding));
}
const staleJob = call("submit_job", { name: "embed", data: { stale: true }, max_attempts: 1, timeout_ms: 240000 });
expect("submit global stale embed job", staleJob, (r) => r && typeof r.id === "number");
if (staleJob && typeof staleJob.id === "number") {
  let observed = null;
  for (let i = 0; i < 300; i += 1) {
    observed = call("get_job", { id: staleJob.id });
    if (observed && ["completed", "failed", "dead", "cancelled"].includes(observed.status)) break;
    sleep(1000);
  }
  expect("get global stale embed job", observed, (r) => r && r.id === staleJob.id && r.status === "completed");
}
expect("stats", call("get_stats"), (r) => r && typeof r === "object");
expect("health after embed", call("get_health"), (r) => r && typeof r === "object" && Number(r.missing_embeddings || 0) === 0);

const failed = evidence.filter((item) => !item.pass);
console.log(JSON.stringify({
  status: failed.length === 0 ? "PASS" : "FAIL",
  target: "openclaw-railway-template",
  canary_slugs: [mainSlug, linkedSlug],
  evidence,
}, null, 2));

if (failed.length) process.exit(1);
`;

const remoteCommand = [
  'env',
  'HOME=/data',
  'GBRAIN_HOME=/data',
  'BRAIN_REPO=/data/brain',
  'BUN_INSTALL=/data/.bun',
  'PATH=/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'node',
  '-e',
  shellQuote(remoteCanary),
].join(' ');

console.error(`target=${target.serviceName} (${target.service})`);
console.error(`environment=${target.environment} (${target.environmentId})`);

const result = spawnSync('railway', [
  'ssh',
  '--project', target.project,
  '--environment', target.environment,
  '--service', target.service,
  remoteCommand,
], {
  encoding: 'utf8',
  timeout: 15 * 60 * 1000,
  maxBuffer: 32 * 1024 * 1024,
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
