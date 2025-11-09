import { Command } from "commander";
import { init, dlqRetry as dbDlqRetry } from "./db.js";
import { enqueueJob, listByState, stats } from "./jobs.js";
import { configGet, configSet, getAllConfig } from "./config.js";
import { jsonTryParse } from "./util.js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

init();

const program = new Command();
program
  .name("queuectl")
  .description("Minimal job queue CLI (Node.js)")
  .version("1.0.0");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PID_DIR = process.env.QUEUECTL_PIDDIR || path.join(process.cwd(), ".queuectl");
const PIDFILE = process.env.QUEUECTL_PIDFILE || path.join(PID_DIR, "workers.pid");
fs.mkdirSync(PID_DIR, { recursive: true });

function readPids() {
  try {
    return fs.readFileSync(PIDFILE, "utf8").trim().split("\n").filter(Boolean).map(Number);
  } catch { return []; }
}
function writePids(pids) {
  fs.writeFileSync(PIDFILE, pids.join("\n") + (pids.length ? "\n" : ""));
}
function isAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

program
  .command("enqueue")
  .argument("<json>", "job as JSON {id, command, max_retries?, run_at?, priority?}")
  .description("Add a new job to the queue")
  .action((json) => {
    const obj = jsonTryParse(json);
    if (!obj) {
      console.error("Invalid JSON.");
      process.exit(1);
    }
    const id = enqueueJob(obj);
    console.log(id);
  });

const worker = program.command("worker").description("Manage workers");

worker
  .command("start")
  .option("--count <n>", "number of worker processes", "1")
  .description("Start one or more workers")
  .action((opts) => {
    const n = Math.max(1, Number(opts.count || 1));
    const pids = readPids().filter(isAlive);
    for (let i = 0; i < n; i++) {
      const child = spawn(process.execPath, [path.join(__dirname, "worker.js")], {
        stdio: "inherit",
        env: { ...process.env }
      });
      pids.push(child.pid);
      console.log(`Started worker PID ${child.pid}`);
    }
    writePids(pids);
  });

worker
  .command("stop")
  .description("Stop running workers gracefully")
  .action(() => {
    const pids = readPids();
    if (!pids.length) {
      console.log("No worker PIDs found.");
      return;
    }
    let still = 0;
    for (const pid of pids) {
      if (isAlive(pid)) {
        try {
          process.kill(pid, "SIGTERM");
          console.log(`Sent SIGTERM to ${pid}`);
          still++;
        } catch (e) {
          console.log(`Could not stop ${pid}: ${e.message}`);
        }
      }
    }
    writePids([]);
    console.log(`Stop requested for ${still} workers.`);
  });

program
  .command("status")
  .description("Show summary of all job states & active workers")
  .action(() => {
    const s = stats();
    const pids = readPids().filter(isAlive);
    console.log("Jobs:", s);
    console.log("Active workers:", pids.length, pids);
  });

program
  .command("list")
  .option("--state <state>", "pending|processing|completed|dead")
  .option("--limit <n>", "limit", "100")
  .description("List jobs")
  .action((opts) => {
    const rows = listByState(opts.state, Number(opts.limit || 100));
    for (const r of rows) {
      console.log(JSON.stringify(r));
    }
  });

const dlq = program.command("dlq").description("Dead Letter Queue");

dlq
  .command("list")
  .description("List DLQ jobs")
  .action(() => {
    const rows = listByState("dead", 200);
    for (const r of rows) console.log(JSON.stringify(r));
  });

dlq
  .command("retry")
  .argument("<id>", "job id to retry from DLQ")
  .description("Retry a DLQ job (moves it to pending)")
  .action((id) => {
    const ok = dbDlqRetry(id);
    if (!ok) {
      console.error("Job not found in DLQ or invalid id.");
      process.exit(1);
    }
    console.log(`Job ${id} moved to pending with attempts=0`);
  });

const cfg = program.command("config").description("Manage configuration");
cfg
  .command("set")
  .argument("<key>")
  .argument("<value>")
  .action((k, v) => {
    try {
      configSet(k, v);
      console.log(`OK: ${k}=${v}`);
    } catch (e) {
      console.error("Error:", e.message);
      process.exit(1);
    }
  });

cfg
  .command("get")
  .argument("<key>")
  .action((k) => {
    const v = configGet(k);
    if (v == null) process.exit(1);
    console.log(v);
  });

cfg
  .command("show")
  .action(() => {
    const all = getAllConfig();
    for (const [k, v] of Object.entries(all)) console.log(`${k}=${v}`);
  });

program.parseAsync(process.argv);
