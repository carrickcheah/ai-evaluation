/** The eval loop: for each test case → ask the bot → grade on the subscription
 * → aggregate. Bounded concurrency (subscription rate limits). */
import type { ProjectConfig, CaseResult, RunResult } from "./types";
import { askBot } from "./bot-runner";
import { gradeAnswer } from "./grader";

export type ProgressFn = (
  done: number,
  total: number,
  last: CaseResult,
  index: number,
) => void | Promise<void>;

function newRunId(): string {
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export async function runEval(
  project: ProjectConfig,
  onProgress?: ProgressFn,
  signal?: AbortSignal,
  // How to get the bot's answer for a question. Default = call the HTTP target
  // (Live-bot mode); Prompt mode passes a subscription-CLI answerer instead.
  answerFn?: (input: string) => Promise<string>,
): Promise<RunResult> {
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
      // Client disconnected (tab closed / Cancel) → stop pulling new cases so we
      // don't keep burning subscription/bot calls for a run nobody is reading.
      if (signal?.aborted) return;
      const i = next++;
      if (i >= total) return;
      const tc = dataset[i]!;
      const description =
        tc.description ?? (tc.tags?.length ? `${tc.tags.join(" · ")} · ${tc.input}` : tc.input);
      const t0 = Date.now();
      let result: CaseResult;
      try {
        const answer = answerFn
          ? await answerFn(tc.input)
          : await askBot(target, tc.input, runSalt, 120_000, signal);
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
        await onProgress?.(done, total, result, i);
      } catch {
        /* ignore progress-callback errors */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, total) }, () => worker()));

  // An aborted run leaves holes in `results`; aggregate only what actually ran.
  const completed = results.filter((r): r is CaseResult => r !== undefined);
  const ran = completed.length;
  const errored = completed.filter((r) => r.error).length;
  const passed = completed.filter((r) => !r.error && r.verdict.pass).length;
  const failed = ran - passed - errored;
  const score = ran ? Math.round((passed / ran) * 100) : 0;

  return {
    id: newRunId(),
    project: project.name,
    judgeModel: judge.model,
    startedAt,
    finishedAt: new Date().toISOString(),
    total: ran,
    passed,
    failed,
    errored,
    score,
    results: completed,
  };
}
