# 🧩 queuectl

A **lightweight production-style background job queue CLI** built with Node.js.  
Supports **multi-process workers**, **retry with exponential backoff**, **Dead Letter Queue (DLQ)**, **persistent job storage (SQLite)**, **configuration management**, and **graceful shutdown** — all from a single command-line tool.

---

## 🚀 Features

✅ Enqueue shell commands as jobs  
✅ Multiple worker processes for parallel execution  
✅ Atomic locking to prevent duplicate processing  
✅ Automatic retries with exponential backoff (`delay = base^attempts`)  
✅ Dead Letter Queue (DLQ) for permanently failed jobs + retry  
✅ Persistent SQLite storage (WAL mode)  
✅ Configurable parameters (`max_retries`, `poll_interval_ms`, etc.)  
✅ Graceful shutdown — finishes current job before exit  
✅ Real-time logging (`worker.log`)

---

## ⚙️ Installation

```bash
# Install dependencies
npm install

# Make the CLI executable
chmod +x bin/queuectl

# (Optional) Link globally for system-wide access
npm link
````

After linking, you can run `queuectl` globally:

```bash
queuectl enqueue '{"command":"echo Hello"}'
```

-----

## 🧠 Quick Start

```bash
# Start 3 worker processes
queuectl worker start --count 3

# Enqueue jobs
queuectl enqueue '{"id":"job1","command":"echo Hello World"}'
queuectl enqueue '{"command":"sleep 2 && echo Done"}'

# View current queue status
queuectl status

# List jobs by state
queuectl list --state pending
queuectl list --state processing
queuectl list --state completed
queuectl list --state failed
queuectl list --state dead

# View Dead Letter Queue (DLQ)
queuectl dlq list

# Retry a DLQ job
queuectl dlq retry job1

# Stop workers gracefully
queuectl worker stop
```

-----

## ⚙️ Config Management

```bash
# Show all config
queuectl config show

# Get a specific config key
queuectl config get backoff_base

# Update configs dynamically
queuectl config set max_retries 3
queuectl config set backoff_base 2
queuectl config set poll_interval_ms 300
```

Config values (persisted in SQLite):

| Key | Description | Default |
| :--- | :--- | :--- |
| `max_retries` | Maximum retry attempts before moving to DLQ | 3 |
| `backoff_base` | Base for exponential backoff | 2 |
| `poll_interval_ms`| Worker polling interval | 500 |

-----

## 🧩 Job Lifecycle

Jobs move through five distinct states:

  * **pending**: Waiting to be picked up by a worker
  * **processing**: Currently executing
  * **completed**: Finished successfully
  * **failed**: Failed but will be retried
  * **dead**: Permanently failed (moved to DLQ)

**Flow:**
`pending` --(reserved by worker)--\> `processing`  
`processing` --(exit 0)--\> `completed`  
`processing` --(exit \> 0)--\> `failed` --\> retry (backoff delay) | `dead`

**DLQ:** Jobs that exceed `max_retries` are marked `dead` and stored in the Dead Letter Queue.

-----

## 🪵 Logging

Each worker logs to `worker.log` (and console):

```
[2025-11-09T08:21:13.456Z] [INFO] Worker 98a91c7f started polling every 500ms
[2025-11-09T08:21:14.024Z] [INFO] ✅ Job job1 completed successfully in 0.02s
[2025-11-09T08:21:20.056Z] [WARN] ⚠️ Job badjob failed (attempt 1/3) — retrying in 2s
[2025-11-09T08:21:26.094Z] [ERROR] ❌ Job badjob failed after 3 attempts — moved to DLQ
```

View logs in real time:

```bash
tail -f worker.log
```

-----

## 🧱 Architecture Overview

### Tables

```sql
CREATE TABLE jobs(
  id TEXT PRIMARY KEY,
  command TEXT NOT NULL,
  state TEXT CHECK (state IN ('pending','processing','completed','failed','dead')),
  attempts INTEGER DEFAULT 0,
  max_retries INTEGER DEFAULT 3,
  created_at TEXT,
  updated_at TEXT,
  available_at TEXT,
  locked_by TEXT,
  locked_at TEXT,
  last_error TEXT,
  priority INTEGER DEFAULT 0
);

CREATE TABLE config(
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### 🔒 Concurrency & Safety

  * **Atomic reservation:** Job pickup (`reserveNextJob`) uses a transactional `SELECT` + `UPDATE` pattern to prevent duplicate processing.
  * **SQLite WAL mode:** Concurrent reads + single-writer guarantee, with `busy_timeout` handling.
  * **Graceful shutdown:** On `SIGINT` / `SIGTERM`, workers stop fetching new jobs but finish the current one before exit.

  Stops workers gracefully

-----

## 🧰 Commands Reference

| Category | Command Example | Description |
| :--- | :--- | :--- |
| **Enqueue** | `queuectl enqueue '{"command":"echo Hi"}'`| Add a new job |
| **Workers** | `queuectl worker start --count 2` | Start workers |
| | `queuectl worker stop` | Stop all workers |
| **Status** | `queuectl status` | Show job summary + worker count |
| **List Jobs** | `queuectl list --state pending` | List by state |
| **DLQ** | `queuectl dlq list` | View DLQ |
| | `queuectl dlq retry job1` | Retry a DLQ job |
| **Config** | `queuectl config set backoff_base 3` | Update config |
| | `queuectl config show` | Show all config |

-----

## 🧩 Architecture Diagram

```
[ enqueue ]
     ↓
 ┌──────────┐
 │  pending │
 └────┬─────┘
      │ (reserveNextJob)
      ↓
 ┌────────────┐
 │ processing │
 └────┬───────┘
      │ exit 0 → completed
      │ exit >0 → failed → retry/backoff
      ↓
 ┌──────────┐
 │   dead   │ ← (max retries exceeded)
 └──────────┘
```

-----

## 🧩 Developer Notes

  * Workers poll using `poll_interval_ms`
  * Retry delay = `backoff_base` ^ `attempts`
  * Logs include job ID, duration, and exit code
  * Supports multiple parallel workers safely
  * Handles `SIGINT` and `SIGTERM` for graceful exit

-----

## 🏁 Summary

`queuectl` provides a minimal but production-realistic job queue system with:

  * SQLite persistence
  * Multi-worker parallelism
  * Safe concurrency control
  * Configurable retries + DLQ
  * Clean CLI management
  * Simple extendable architecture

<!-- end list -->

```
