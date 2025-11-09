import { customAlphabet } from "nanoid";
import { insertJob, listJobsByState, countsByState, getConfig } from "./db.js";
import { nowISO } from "./util.js";

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export function enqueueJob(input) {
  const id = input.id || nanoid();
  if (!input.command || typeof input.command !== "string") {
    throw new Error("Job must include a 'command' string");
  }
  const created = nowISO();
  const maxRetries = input.max_retries != null ? Number(input.max_retries) : Number(getConfig("max_retries") ?? 3);
  const priority = Number.isFinite(Number(input.priority)) ? Number(input.priority) : 0;

  const job = {
    id,
    command: input.command,
    max_retries: maxRetries,
    created_at: created,
    updated_at: created,
    available_at: input.run_at ? new Date(input.run_at).toISOString() : created,
    priority
  };
  
  insertJob(job);
  return id;
}

export function listByState(state, limit) {
  return listJobsByState(state, limit);
}

export function stats() {
  return countsByState();
}
