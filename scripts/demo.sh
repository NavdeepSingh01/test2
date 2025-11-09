#!/usr/bin/env bash
set -euo pipefail

echo "Resetting DB..."
rm -f queuectl.db

echo "Stop any running workers..."
queuectl worker stop

echo "Show current config..."
queuectl config show

echo "Update config values..."
queuectl config set max_retries 2
queuectl config set backoff_base 2
queuectl config set poll_interval_ms 300

echo "Config after updates..."
queuectl config show

echo "Start 2 workers..."
queuectl worker start --count 2

echo "Enqueue some jobs..."
queuectl enqueue '{"id":"Job1","command":"echo Hello"}'
queuectl enqueue '{"command":"sleep 2 && echo Done"}'
queuectl enqueue '{"command":"bash -c '\''exit 1'\''", "max_retries": 2}'
queuectl enqueue '{"command":"bash -c '\''exit 2'\''", "max_retries": 1}'
queuectl enqueue '{"command":"bash -c '\''command-not-found'\''", "max_retries": 1}'

echo "Check status..."
queuectl status

echo "Wait 8s for retries/backoff..."
sleep 8
queuectl status

echo "List all pending jobs..."
queuectl list --state pending

echo "List all processing jobs..."
queuectl list --state processing

echo "List all completed jobs..."
queuectl list --state completed

echo "List all failed jobs..."
queuectl list --state failed

echo "List all dead (DLQ) jobs..."
queuectl list --state dead

echo "Show DLQ list..."
queuectl dlq list

echo "Retry first DLQ job if any..."

queuectl dlq retry "$DLQ_ID"
echo "Retried DLQ job: $DLQ_ID"


echo "Show config get/set demo..."
queuectl config get backoff_base
queuectl config set backoff_base 3
queuectl config show

echo "Stop workers..."
queuectl worker stop

echo "Final status..."
queuectl status

echo "Demo complete ✅"
