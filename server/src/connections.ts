/** Bot "connections" — named, persisted target endpoints the UI can pick between
 * (e.g. Local vs Live production), so a dataset runs against any bot without a
 * per-endpoint project. Stored in connections.json; secrets stay as ${ENV}
 * placeholders, resolved (config.ts-style) only when a connection is USED. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { Connection } from "./types";

export const CONNECTIONS_PATH =
  process.env.CONNECTIONS_PATH || resolve(import.meta.dir, "../../connections.json");

/** Default Flabee request body — same shape every Flabee project uses. */
const FLABEE_BODY = {
  message: "{{input}}",
  phone_number: "{{uid}}",
  source: "api",
  account_id: 14,
  session_id: "{{uid}}",
};

const SEED: Connection[] = [
  {
    id: "local",
    name: "Local (localhost:8002)",
    url: "http://localhost:8002/api/chat/sync",
    method: "POST",
    headers: {},
    body: FLABEE_BODY,
    answerPath: "output",
  },
  {
    id: "production",
    name: "Live bot — production (Contabo)",
    url: "https://api.nexgpt.nexerp.io/api/chat/sync",
    method: "POST",
    headers: { "X-API-Key": "${BOT_KEY}" },
    body: FLABEE_BODY,
    answerPath: "output",
  },
];

function load(): Connection[] {
  if (!existsSync(CONNECTIONS_PATH)) {
    writeFileSync(CONNECTIONS_PATH, JSON.stringify(SEED, null, 2) + "\n", "utf8");
    return [...SEED];
  }
  try {
    const arr = JSON.parse(readFileSync(CONNECTIONS_PATH, "utf8")) as Connection[];
    return Array.isArray(arr) ? arr : [...SEED];
  } catch {
    return [...SEED];
  }
}

function save(conns: Connection[]): void {
  writeFileSync(CONNECTIONS_PATH, JSON.stringify(conns, null, 2) + "\n", "utf8");
}

/** Raw list (with ${ENV} placeholders) — for the settings UI. */
export function listConnections(): Connection[] {
  return load();
}

/** Recursively replace ${VAR} in string values (fail loud on missing env). */
function resolveEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{(\w+)\}/g, (_, name: string) => {
      const v = process.env[name];
      if (v === undefined || v === "") {
        throw new Error(`Connection references missing/empty env var: ${name}`);
      }
      return v;
    });
  }
  if (Array.isArray(value)) return value.map(resolveEnv);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveEnv(v);
    return out;
  }
  return value;
}

/** Env-resolved connection for use as an eval target. Throws on missing env. */
export function resolveConnection(id: string): Connection | null {
  const conn = load().find((c) => c.id === id);
  if (!conn) return null;
  return resolveEnv(conn) as Connection;
}

function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
}

/** Create or update a connection (by id, else derived from name). */
export function upsertConnection(input: Partial<Connection>): Connection {
  const conns = load();
  const name = (input.name ?? "").trim() || "Untitled";
  const id = (input.id && slugify(input.id)) || slugify(name) || `conn-${conns.length + 1}`;
  const conn: Connection = {
    id,
    name,
    url: (input.url ?? "").trim(),
    method: input.method || "POST",
    headers: input.headers ?? {},
    body: input.body ?? {},
    answerPath: input.answerPath || "output",
  };
  const idx = conns.findIndex((c) => c.id === id);
  if (idx >= 0) conns[idx] = conn;
  else conns.push(conn);
  save(conns);
  return conn;
}

export function deleteConnection(id: string): boolean {
  const conns = load();
  const next = conns.filter((c) => c.id !== id);
  if (next.length === conns.length) return false;
  save(next);
  return true;
}
