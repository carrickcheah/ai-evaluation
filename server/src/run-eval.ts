/** The eval loop: for each test case → ask the bot → grade on the subscription
 * → aggregate. Bounded concurrency (subscription rate limits). */
import type { ProjectConfig, CaseResult, RunResult } from "./types";
import { askBot } from "./bot-runner";
import { gradeAnswer } from "./grader";

export type ProgressFn = (done: number, total: number, last: CaseResult) => void | Promise<void>;

function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function runEval(project: ProjectConfig, onProgress?: ProgressFn): Promise<RunResult> {
  const { dataset, target, judge, rubric } = project;
  const total = dataset.length;
  const results: CaseResult[] = new Array(total);
  const concurrency = Math.max(1, Math.min(8, Number(process.env.EVAL_CONCURRENCY) || 3));
  const startedAt = new Date().toISOString();
  // Per-run salt → every run is a fresh bot conversation (no "already answered").
  const runSalt = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  let next = 0;
  let done = 0;

  async function worker(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= total) return;
      const tc = dataset[i]!;
      const description =
        tc.description ?? (tc.tags?.length ? `${tc.tags.join(" · ")} · ${tc.input}` : tc.input);
      const t0 = Date.now();
      let result: CaseResult;
      try {
        const answer = await askBot(target, tc.input, runSalt);
        const verdict = await gradeAnswer(rubric, tc.input, tc.expected, answer, judge.model);
        result = {
          input: tc.input,
          expected: tc.expected,
          answer,
          tags: tc.tags ?? [],
          description,
          latencyMs: Date.now() - t0,
          verdict,
        };
      } catch (err) {
        result = {
          input: tc.input,
          expected: tc.expected,
          answer: "",
          tags: tc.tags ?? [],
          description,
          latencyMs: Date.now() - t0,
          verdict: { pass: false, score: 0, reason: "run/grade error" },
          error: err instanceof Error ? err.message : String(err),
        };
      }
      results[i] = result;
      done++;
      // onProgress is caller-supplied (UI) — never let it abort the run / sibling workers.
      try {
        await onProgress?.(done, total, result);
      } catch {
        /* ignore progress-callback errors */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

  const errored = results.filter((r) => r.error).length;
  const passed = results.filter((r) => !r.error && r.verdict.pass).length;
  const failed = total - passed - errored;
  const score = total ? Math.round((passed / total) * 100) : 0;

  return {
    id: newRunId(),
    project: project.name,
    judgeModel: judge.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    total,
    passed,
    failed,
    errored,
    score,
    results,
  };
}
