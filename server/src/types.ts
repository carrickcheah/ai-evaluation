/** Shared types for the eval tool. */

/** One test case from a project's dataset.json. */
export interface TestCase {
  input: string;
  expected: string;
  tags?: string[];
  /** Optional short label for the table's Description column. */
  description?: string;
}

/** The bot under test — any HTTP endpoint, defined in eval.config.yaml. */
export interface TargetConfig {
  url: string;
  method?: string; // default POST
  headers?: Record<string, string>;
  /** Request body template; {{input}} and {{uid}} are substituted per case. */
  body?: unknown;
  /** Dot-path into the JSON response where the reply text lives (e.g. "output"). */
  answerPath: string;
}

export interface JudgeConfig {
  /** Only "claude-subscription" is supported (local claude CLI, no API key). */
  provider: string;
  /** claude CLI model id/alias, e.g. "sonnet" or "claude-sonnet-4-6". */
  model: string;
}

/** A fully-loaded, env-resolved project. */
export interface ProjectConfig {
  name: string;
  target: TargetConfig;
  judge: JudgeConfig;
  rubric: string;
  datasetPath: string;
  dataset: TestCase[];
}

/** The judge's verdict for one answer. */
export interface Verdict {
  pass: boolean;
  score: number; // 1-10
  reason: string;
}

/** Result for a single test case after running + grading. */
export interface CaseResult {
  input: string;
  expected: string;
  answer: string;
  tags: string[];
  description: string; // label for the Description column
  latencyMs: number; // bot call + grading time for this case
  verdict: Verdict;
  error?: string; // set when the bot call or grading failed
  rating?: "up" | "down" | null; // human review rating (👍/👎)
  comment?: string; // human review comment
}

/** Aggregated result of one eval run. */
export interface RunResult {
  id: string;
  project: string;
  judgeModel: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  passed: number;
  failed: number;
  errored: number;
  score: number; // percent passed, 0-100
  results: CaseResult[];
}
