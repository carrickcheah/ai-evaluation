/** Run history in SQLite (data/eval.db). Same API as before. */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { db } from "./db";
import type { RunResult, CaseResult } from "./types";

/** Summary of a run without the (potentially large) per-case results. */
export type RunSummary = Omit<RunResult, "results">;

const insertStmt = db.query(
  `INSERT OR REPLACE INTO runs
     (id, project, judge_model, started_at, finished_at, total, passed, failed, errored, score, cancelled, results_json)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

export function saveRun(run: RunResult): void {
  insertStmt.run(
    run.id,
    run.project,
    run.judgeModel,
    run.startedAt,
    run.finishedAt,
    run.total,
    run.passed,
    run.failed,
    run.errored,
    run.score,
    run.cancelled ? 1 : 0,
    JSON.stringify(run.results),
  );
}

/** All run summaries, newest first. */
export function listRuns(): RunSummary[] {
  return db
    .query(
      `SELECT id, project, judge_model AS judgeModel, started_at AS startedAt,
              finished_at AS finishedAt, total, passed, failed, errored, score,
              cancelled
         FROM runs ORDER BY started_at DESC`,
    )
    .all()
    .map((r) => {
      const row = r as Omit<RunSummary, "cancelled"> & { cancelled: number };
      return { ...row, cancelled: !!row.cancelled };
    });
}

interface RunRow {
  id: string;
  project: string;
  judge_model: string;
  started_at: string;
  finished_at: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  score: number;
  cancelled: number;
  results_json: string;
}

/** Full run by id, or null if missing/corrupt. */
export function getRun(id: string): RunResult | null {
  const row = db.query(`SELECT * FROM runs WHERE id = ?`).get(id) as RunRow | undefined;
  if (!row) return null;
  try {
    return {
      id: row.id,
      project: row.project,
      judgeModel: row.judge_model,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      total: row.total,
      passed: row.passed,
      failed: row.failed,
      errored: row.errored,
      score: row.score,
      cancelled: !!row.cancelled,
      results: JSON.parse(row.results_json) as CaseResult[],
    };
  } catch {
    return null;
  }
}

/** Persist a human review rating/comment onto one case of a saved run. */
export function updateCase(
  runId: string,
  index: number,
  patch: { rating?: "up" | "down" | null; comment?: string },
): CaseResult | null {
  const run = getRun(runId);
  if (!run || index < 0 || index >= run.results.length) return null;
  const c = run.results[index]!;
  if ("rating" in patch) c.rating = patch.rating ?? null;
  if (typeof patch.comment === "string") c.comment = patch.comment;
  db.query(`UPDATE runs SET results_json = ? WHERE id = ?`).run(JSON.stringify(run.results), runId);
  return c;
}

/** One-time import of any legacy data/runs/*.json files into SQLite. */
export function migrateJsonRuns(): void {
  const dir = process.env.RUNS_DIR || resolve(import.meta.dir, "../data/runs");
  if (!existsSync(dir)) return;
  let imported = 0;
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const run = JSON.parse(readFileSync(join(dir, f), "utf8")) as RunResult;
      if (!run?.id) continue;
      if (db.query(`SELECT 1 FROM runs WHERE id = ?`).get(run.id)) continue;
      saveRun(run);
      imported++;
    } catch {
      /* skip corrupt file */
    }
  }
  if (imported > 0) console.log(`[db] imported ${imported} legacy JSON run(s) into SQLite`);
}
