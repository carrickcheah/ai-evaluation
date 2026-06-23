/** Multi-model comparison: run the SAME dataset against N models (each a column)
 * in Prompt mode on the subscription ($0), grading every cell with the project's
 * judge. Produces a matrix (rows = cases, columns = models) + per-column summary. */
import type { ProjectConfig, Verdict } from "./types";
import { askPrompt } from "./prompt-runner";
import { gradeAnswer } from "./grader";

export interface MatrixVariant {
  key: string;
  label: string;
  model: string;
}
export interface MatrixCell {
  answer: string;
  verdict: Verdict;
  error?: string;
  latencyMs?: number;
  pending?: boolean;
}
export interface MatrixRow {
  input: string;
  expected: string;
  tags: string[];
  description?: string;
  cells: MatrixCell[]; // one per variant, same index order as variants
}
export interface MatrixResult {
  id: string;
  project: string;
  judgeModel: string;
  variants: MatrixVariant[];
  rows: MatrixRow[];
  summary: Array<{ key: string; label: string; pass: number; fail: number; errored: number; total: number; score: number }>;
}

export type MatrixProgressFn = (
  row: number,
  col: number,
  cell: MatrixCell,
  totalCells: number,
) => void | Promise<void>;

function newId(): string {
  return `mtx-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

const pending = (): MatrixCell => ({ answer: "", verdict: { pass: false, score: 0, reason: "" }, pending: true });

export async function runMatrix(
  project: ProjectConfig,
  systemPrompt: string,
  models: string[],
  onProgress?: MatrixProgressFn,
  signal?: AbortSignal,
): Promise<MatrixResult> {
  const { dataset, rubric, judge } = project;
  const variants: MatrixVariant[] = models.map((m) => ({ key: m, label: m, model: m }));
  const rows: MatrixRow[] = dataset.map((d) => ({
    input: d.input,
    expected: d.expected,
    tags: d.tags ?? [],
    description: d.description,
    cells: variants.map(() => pending()),
  }));

  // Flat task list over (row, col) so one bounded pool covers the whole matrix.
  const tasks: Array<{ r: number; c: number }> = [];
  for (let r = 0; r < dataset.length; r++) {
    for (let c = 0; c < variants.length; c++) tasks.push({ r, c });
  }
  const totalCells = tasks.length;
  const concurrency = Math.max(1, Math.min(8, Number(process.env.EVAL_CONCURRENCY) || 3));
  let next = 0;

  async function worker(): Promise<void> {
    while (true) {
      if (signal?.aborted) return; // stop pulling new cells on client disconnect
      const i = next++;
      if (i >= totalCells) return;
      const { r, c } = tasks[i]!;
      const tc = dataset[r]!;
      const model = variants[c]!.model;
      const t0 = Date.now();
      let cell: MatrixCell;
      try {
        const answer = await askPrompt(systemPrompt, tc.input, model, 120_000, signal);
        const verdict = await gradeAnswer(rubric, tc.input, tc.expected, answer, judge.model);
        cell = { answer, verdict, latencyMs: Date.now() - t0 };
      } catch (err) {
        cell = {
          answer: "",
          verdict: { pass: false, score: 0, reason: "run/grade error" },
          error: err instanceof Error ? err.message : String(err),
          latencyMs: Date.now() - t0,
        };
      }
      rows[r]!.cells[c] = cell;
      try {
        await onProgress?.(r, c, cell, totalCells);
      } catch {
        /* never let a progress callback abort the matrix */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, totalCells || 1) }, () => worker()));

  const summary = variants.map((v, c) => {
    const cells = rows.map((row) => row.cells[c]!).filter((cell) => !cell.pending);
    const pass = cells.filter((x) => !x.error && x.verdict.pass).length;
    const errored = cells.filter((x) => x.error).length;
    const fail = cells.length - pass - errored;
    return {
      key: v.key,
      label: v.label,
      pass,
      fail,
      errored,
      total: cells.length,
      score: cells.length ? Math.round((pass / cells.length) * 100) : 0,
    };
  });

  return { id: newId(), project: project.name, judgeModel: judge.model, variants, rows, summary };
}
