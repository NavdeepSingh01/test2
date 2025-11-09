import { exec } from "node:child_process";
import fs from "fs";
import {
  reserveNextJob,
  markJobSuccess,
  markJobFailed,
  requeueWithBackoff,
  markJobDead,
  getConfig,
} from "./db.js";
import { sleep, addSecondsISO } from "./util.js";
import { randomUUID } from "node:crypto";

const workerId = process.env.WORKER_ID || randomUUID();
const LOG_FILE = "worker.log";

function logToFile(level, message) {
  const ts = new Date().toISOString();
  const formatted = `[${ts}] [${level}] ${message}\n`;
  fs.appendFileSync(LOG_FILE, formatted);
  // Also echo to console
  if (level === "ERROR") console.error(formatted.trim());
  else if (level === "WARN") console.warn(formatted.trim());
  else console.log(formatted.trim());
}

let stopping = false;
process.on("SIGTERM", () => { stopping = true; });
process.on("SIGINT", () => { stopping = true; });


function runCommand(cmd, timeoutMs) {
  return new Promise((resolve) => {
    const start = new Date();
    const child = exec(cmd, { timeout: timeoutMs }, (error, stdout, stderr) => {
      const end = new Date();
      const duration = ((end - start) / 1000).toFixed(2);
      resolve({
        error,
        stdout,
        stderr,
        code: error && "code" in error ? error.code : 0,
        duration,
      });
    });
  });
}

function computeBackoffSeconds(attempts) {
  const base = Number(getConfig("backoff_base") ?? 2);
  return Math.pow(base, attempts);
}

async function processLoop() {
  const pollMs = Number(getConfig("poll_interval_ms") ?? 500);
  logToFile("INFO", `Worker ${workerId} started polling every ${pollMs}ms`);

  while (!stopping) {
    const job = reserveNextJob(workerId);
    if (!job) {
      await sleep(pollMs);
      continue;
    }

    const timeoutMs = Number(getConfig("job_timeout_ms") ?? 0) || undefined;
    logToFile("INFO", `Picked job ${job.id}: "${job.command}" (attempt ${job.attempts + 1}/${job.max_retries})`);

    const { code, error, duration } = await runCommand(job.command, timeoutMs);

    if (code === 0) {
      logToFile("INFO", `✅ Job ${job.id} completed successfully in ${duration}s`);
      markJobSuccess(job.id);
    } else {
      const nextAttempts = job.attempts + 1;
      const errMsg = error || `Exit code ${code}`;

      if (nextAttempts > job.max_retries) {
        logToFile("ERROR", `❌ Job ${job.id} failed after ${job.max_retries} attempts — moved to DLQ (${errMsg})`);
        markJobDead(job.id, errMsg);
      } else {
        const delay = computeBackoffSeconds(nextAttempts);
        logToFile("WARN", `⚠️ Job ${job.id} failed (attempt ${nextAttempts}/${job.max_retries}) — retrying in ${delay}s (${errMsg})`);
        markJobFailed(job.id, errMsg);

        const nextAt = addSecondsISO(delay);
        requeueWithBackoff(job.id, nextAt, nextAttempts, errMsg);
      }
    }

    if (stopping) break;
  }

  logToFile("INFO", `Worker ${workerId} stopped gracefully`);
}

processLoop().catch((e) => {
  logToFile("ERROR", `Worker fatal error: ${e.message || e}`);
  process.exit(1);
});
