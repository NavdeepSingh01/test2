export const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

export function nowISO() {
  return new Date().toISOString();
}

export function addSecondsISO(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

export function jsonTryParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

export function ensureInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
