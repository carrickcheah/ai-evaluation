/** Run history persisted as JSON files under data/runs/. */
import { mkdirSync, readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RunResult } from "./types";

const RUNS_DIR = process.env.RUNS_DIR || resolve(import.meta.dir, "../data/runs");

/** Summary of a run without the (potentially large) per-case results. */
export type RunSummary = Omit<RunResult, "results">;

export function saveRun(run: RunResult): void {
  mkdirSync(RUNS_DIR, { recursive: true });
  const safe = run.id.replace(/[^A-Za-z0-9._-]/g, "");
  writeFileSync(join(RUNS_DIR, `${safe}.json`), JSON.stringify(run, null, 2));
}

/** All run summaries, newest first. Corrupt files are skipped, not fatal. */
export function listRuns(): RunSummary[] {
  if (!existsSync(RUNS_DIR)) return [];
  const summaries: RunSummary[] = [];
  for (const f of readdirSync(RUNS_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const r = JSON.parse(readFileSync(join(RUNS_DIR, f), "utf8")) as RunResult;
      const { results: _omit, ...summary } = r;
      summaries.push(summary);
    } catch {
      /* skip corrupt run file */
    }
  }
  summaries.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return summaries;
}

/** Full run by id, or null if missing/corrupt. */
export function getRun(id: string): RunResult | null {
  const safe = id.replace(/[^A-Za-z0-9._-]/g, "");
  const p = join(RUNS_DIR, `${safe}.json`);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf8")) as RunResult;
  } catch {
    return null;
  }
}
