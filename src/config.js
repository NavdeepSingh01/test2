import { getConfig, setConfig, allConfig } from "./db.js";
import { ensureInt } from "./util.js";

export function getAllConfig() {
  const rows = allConfig();
  const m = {};
  for (const { key, value } of rows) m[key] = value;
  return m;
}

export function configGet(key) {
  return getConfig(key);
}

export function configSet(key, value) {
  if (["max_retries", "backoff_base", "poll_interval_ms"].includes(key)) {
    const n = ensureInt(value, null);
    if (n === null || n < 0) throw new Error("Value must be a non-negative number");
    setConfig(key, n);
    return;
  }
  setConfig(key, value);
}
