#!/usr/bin/env node
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const DIRECT = process.env.DIRECT_MINIONS_DIR || "/data/.openclaw/cron/direct-minions";
const MANIFEST = path.join(DIRECT, "jobs.json");
const LOG_DIR = path.join(DIRECT, "logs");
const LOCK_DIR = path.join(DIRECT, "locks");
const WORKSPACE = "/data/.openclaw/workspace";

async function readManifest() {
  return JSON.parse(await fs.readFile(MANIFEST, "utf8"));
}

function getJobs(manifest) {
  return Array.isArray(manifest) ? manifest : manifest.jobs || [];
}

function isEnabled(job) {
  return job.enabled !== false;
}

function sanitize(value) {
  return String(value).replace(/[^a-zA-Z0-9_.-]+/g, "_");
}

function redactCommand(command) {
  return String(command || "")
    .replace(/Bearer\s+\S+/gi, "Bearer REDACTED")
    .replace(/sk-[A-Za-z0-9_-]{20,}/g, "sk-REDACTED")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "POSTGRES_URL_REDACTED");
}

async function appendLog(file, line) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.appendFile(file, line);
}

async function withLock(job, fn) {
  await fs.mkdir(LOCK_DIR, { recursive: true });
  const lockPath = path.join(LOCK_DIR, sanitize(job.name) + ".lock");
  try {
    const fd = await fs.open(lockPath, "wx");
    await fd.writeFile(JSON.stringify({ pid: process.pid, job: job.name, createdAt: new Date().toISOString() }));
    try {
      return await fn();
    } finally {
      await fd.close().catch(() => {});
      await fs.unlink(lockPath).catch(() => {});
    }
  } catch (error) {
    if (error && error.code === "EEXIST") {
      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > 4 * 60 * 60 * 1000) {
        await fs.unlink(lockPath).catch(() => {});
        return withLock(job, fn);
      }
      await appendLog(path.join(LOG_DIR, "scheduler.log"), JSON.stringify({ ts: new Date().toISOString(), event: "skip_locked", job: job.name }) + "\n");
      return { status: "locked" };
    }
    throw error;
  }
}

async function runJob(job, reason = "scheduled") {
  if (!isEnabled(job) && reason !== "manual-force") {
    await appendLog(path.join(LOG_DIR, "scheduler.log"), JSON.stringify({ ts: new Date().toISOString(), event: "skip_disabled", job: job.name, reason }) + "\n");
    return { status: "disabled" };
  }

  return withLock(job, () => new Promise((resolve) => {
    const startedAt = new Date().toISOString();
    const stdoutPath = path.join(LOG_DIR, sanitize(job.name) + ".stdout.log");
    const stderrPath = path.join(LOG_DIR, sanitize(job.name) + ".stderr.log");
    appendLog(path.join(LOG_DIR, "scheduler.log"), JSON.stringify({ ts: startedAt, event: "start", job: job.name, reason, command: redactCommand(job.command) }) + "\n").catch(() => {});

    const child = spawn("/bin/bash", ["-lc", job.command], {
      cwd: fsSync.existsSync(WORKSPACE) ? WORKSPACE : "/data",
      env: {
        ...process.env,
        PATH: "/data/.bun/bin:/app/node_modules/.bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        DIRECT_MINIONS_JOB_NAME: job.name,
        DIRECT_MINIONS_JOB_ID: job.id,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => appendLog(stdoutPath, chunk).catch(() => {}));
    child.stderr.on("data", (chunk) => appendLog(stderrPath, chunk).catch(() => {}));
    child.on("error", (error) => {
      appendLog(path.join(LOG_DIR, "scheduler.log"), JSON.stringify({ ts: new Date().toISOString(), event: "error", job: job.name, message: error.message }) + "\n").catch(() => {});
      resolve({ status: "error", error: error.message });
    });
    child.on("exit", (code, signal) => {
      child.stdout.destroy();
      child.stderr.destroy();
      appendLog(path.join(LOG_DIR, "scheduler.log"), JSON.stringify({ ts: new Date().toISOString(), event: "finish", job: job.name, code, signal }) + "\n").catch(() => {});
      resolve({ status: code === 0 ? "ok" : "failed", code, signal });
    });
  }));
}

async function loadCroner() {
  const mod = await import("file:///app/node_modules/croner/dist/croner.js");
  return mod.Cron || mod.default?.Cron || mod.default;
}

const args = process.argv.slice(2);
const manifest = await readManifest();
const jobs = getJobs(manifest);

if (args[0] === "--list") {
  const enabledOnly = args.includes("--enabled-only");
  const listed = enabledOnly ? jobs.filter(isEnabled) : jobs;
  console.log(JSON.stringify(listed.map((job) => ({
    id: job.id,
    name: job.name,
    enabled: isEnabled(job),
    expr: job.schedule?.expr,
    tz: job.schedule?.tz || job.schedule?.timezone || "system",
    command: redactCommand(job.command),
  })), null, 2));
  process.exit(0);
}

if (args[0] === "--validate") {
  const cronJobs = jobs.filter((job) => job.schedule?.kind === "cron" && job.schedule?.expr);
  const enabledCronJobs = cronJobs.filter(isEnabled);
  const disabledCronJobs = cronJobs.filter((job) => !isEnabled(job));
  console.log(JSON.stringify({
    manifest: MANIFEST,
    total: jobs.length,
    cron: cronJobs.length,
    enabled_cron: enabledCronJobs.length,
    disabled_cron: disabledCronJobs.length,
    disabled_names: disabledCronJobs.map((job) => job.name),
  }, null, 2));
  process.exit(0);
}

if (args[0] === "--once") {
  const forceDisabled = args.includes("--force-disabled");
  const target = args[1];
  const job = jobs.find((item) => item.name === target || item.id === target);
  if (!job) {
    console.error("Unknown direct-minions job:", target);
    process.exit(2);
  }
  const result = await runJob(job, !isEnabled(job) && forceDisabled ? "manual-force" : "manual");
  console.log(JSON.stringify({ job: job.name, enabled: isEnabled(job), result }, null, 2));
  process.exit(["ok", "locked", "disabled"].includes(result.status) ? 0 : 1);
}

await fs.mkdir(LOG_DIR, { recursive: true });
const Cron = await loadCroner();
const schedules = [];
const disabled = [];

for (const job of jobs) {
  if (job.schedule?.kind !== "cron" || !job.schedule?.expr) {
    continue;
  }
  if (!isEnabled(job)) {
    disabled.push(job.name);
    await appendLog(path.join(LOG_DIR, "scheduler.log"), JSON.stringify({ ts: new Date().toISOString(), event: "skip_disabled_startup", job: job.name }) + "\n");
    continue;
  }
  const options = {};
  const tz = job.schedule.tz || job.schedule.timezone;
  if (tz) options.timezone = tz;
  schedules.push(new Cron(job.schedule.expr, options, () => {
    runJob(job).catch((error) => {
      appendLog(path.join(LOG_DIR, "scheduler.log"), JSON.stringify({ ts: new Date().toISOString(), event: "unhandled", job: job.name, message: error.message }) + "\n").catch(() => {});
    });
  }));
}

await appendLog(path.join(LOG_DIR, "scheduler.log"), JSON.stringify({ ts: new Date().toISOString(), event: "scheduler_started", jobs: schedules.length, disabled: disabled.length }) + "\n");
console.log(JSON.stringify({ schedulerStarted: true, jobs: schedules.length, disabled: disabled.length, manifest: MANIFEST }));
setInterval(() => {}, 60 * 60 * 1000);
