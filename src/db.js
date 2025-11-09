import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { nowISO } from "./util.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_PATH = path.join(process.cwd(), "queuectl.db");

const dbPath = process.env.QUEUECTL_DB || DEFAULT_DB_PATH;
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("busy_timeout = 5000")
db.pragma("foreign_keys = ON");

export function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN ('pending','processing','completed','failed','dead')),
      attempts INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 3,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      available_at TEXT NOT NULL,
      locked_by TEXT,
      locked_at TEXT,
      last_error TEXT,
      priority INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_state_available
      ON jobs (state, available_at);

    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  const defaults = [
    ["max_retries", "3"],
    ["backoff_base", "2"],
    ["poll_interval_ms", "500"]
  ];
  const get = db.prepare("SELECT value FROM config WHERE key=?");
  const put = db.prepare("INSERT INTO config(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING");
  for (const [k, v] of defaults) {
    const row = get.get(k);
    if (!row) put.run(k, v);
  }
}

export function insertJob(job) {
  const stmt = db.prepare(`
    INSERT INTO jobs (id, command, state, attempts, max_retries, created_at, updated_at, available_at, priority)
    VALUES (@id, @command, 'pending', 0, @max_retries, @created_at, @updated_at, @available_at, @priority)
  `);
  stmt.run(job);
}

export function getJob(id) {
  return db.prepare(`SELECT * FROM jobs WHERE id=?`).get(id);
}

export function listJobsByState(state, limit = 100) {
  if (state) {
    return db.prepare(
      `SELECT * FROM jobs WHERE state=? ORDER BY created_at ASC LIMIT ?`
    ).all(state, limit);
  }
  return db.prepare(
    `SELECT * FROM jobs ORDER BY created_at DESC LIMIT ?`
  ).all(limit);
}

export function countsByState() {
  const rows = db.prepare(`
    SELECT state, COUNT(*) as count
    FROM jobs
    GROUP BY state
  `).all();
  const m = { pending: 0, processing: 0, completed: 0, failed: 0, dead: 0 };
  for (const r of rows) m[r.state] = r.count;
  return m;
}

export function reserveNextJob(workerId) {
  const tx = db.transaction((wid) => {
    const row = db.prepare(`
      SELECT * FROM jobs
      WHERE state='pending' AND available_at <= ?
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get(nowISO());
    if (!row) return null;

    const upd = db.prepare(`
      UPDATE jobs
      SET state='processing', locked_by=?, locked_at=?, updated_at=?
      WHERE id=? AND state='pending'
    `);
    const ts = nowISO();
    const res = upd.run(wid, ts, ts, row.id);
    if (res.changes === 0) return null;
    return { ...row, state: "processing", locked_by: wid, locked_at: ts, updated_at: ts };
  });
  return tx(workerId);
}

export function markJobSuccess(id) {
  const ts = nowISO();
  db.prepare(`
    UPDATE jobs
    SET state='completed', updated_at=?, locked_by=NULL, locked_at=NULL, last_error=NULL
    WHERE id=?
  `).run(ts, id);
}

export function markJobDead(id, error) {
  const ts = nowISO();
  db.prepare(`
    UPDATE jobs
    SET state='dead', updated_at=?, locked_by=NULL, locked_at=NULL, last_error=?
    WHERE id=?
  `).run(ts, error?.toString() ?? null, id);
}

export function markJobFailed(id, error) {
  const ts = nowISO();
  db.prepare(`
    UPDATE jobs
    SET state='failed',
        updated_at=?,
        locked_by=NULL,
        locked_at=NULL,
        last_error=?
    WHERE id=?
  `).run(ts, error?.toString() ?? null, id);
}

export function requeueWithBackoff(id, nextISO, attempts, error) {
  const ts = nowISO();
  db.prepare(`
    UPDATE jobs
    SET state='pending',
        updated_at=?,
        available_at=?,
        attempts=?,
        locked_by=NULL,
        locked_at=NULL,
        last_error=?
    WHERE id=?
  `).run(ts, nextISO, attempts, error?.toString() ?? null, id);
}

export function dlqRetry(id) {
  const j = getJob(id);
  if (!j || j.state !== "dead") return false;
  const ts = nowISO();
  db.prepare(`
    UPDATE jobs
    SET state='pending',
        attempts=0,
        updated_at=?,
        available_at=?,
        last_error=NULL
    WHERE id=?
  `).run(ts, ts, id);
  return true;
}

export function setConfig(k, v) {
  db.prepare(`
    INSERT INTO config(key,value) VALUES(?,?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(k, String(v));
}

export function getConfig(k) {
  const r = db.prepare(`SELECT value FROM config WHERE key=?`).get(k);
  return r ? r.value : null;
}

export function allConfig() {
  return db.prepare(`SELECT key, value FROM config ORDER BY key`).all();
}
