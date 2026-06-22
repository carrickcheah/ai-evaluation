/** SQLite storage (bun:sqlite — no external dependency). One file at data/eval.db.
 * Holds eval runs and key/value settings (e.g. the subscription pref). */
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const DB_PATH = process.env.EVAL_DB || resolve(import.meta.dir, "../data/eval.db");
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new Database(DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

db.exec(`
  CREATE TABLE IF NOT EXISTS runs (
    id           TEXT PRIMARY KEY,
    project      TEXT NOT NULL,
    judge_model  TEXT NOT NULL,
    started_at   TEXT NOT NULL,
    finished_at  TEXT NOT NULL,
    total        INTEGER NOT NULL,
    passed       INTEGER NOT NULL,
    failed       INTEGER NOT NULL,
    errored      INTEGER NOT NULL,
    score        INTEGER NOT NULL,
    results_json TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs (started_at DESC);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);
