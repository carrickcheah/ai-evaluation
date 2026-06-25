export interface Verdict {
  pass: boolean;
  score: number;
  reason: string;
}
export interface CaseResult {
  input: string;
  expected: string;
  answer: string;
  tags: string[];
  description?: string;
  latencyMs?: number;
  verdict: Verdict;
  error?: string;
  rating?: "up" | "down" | null;
  comment?: string;
  pending?: boolean; // UI-only: row laid out but not yet run/graded
}
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
  score: number;
  cancelled?: boolean;
  results: CaseResult[];
}
export type RunSummary = Omit<RunResult, "results">;

export interface ProjectInfo {
  name: string;
  displayName: string;
  cases: number;
  judge: string;
  error: string | null;
}
export interface CliInfo {
  detected: boolean;
  path: string | null;
  version: string | null;
}
export interface SubscriptionStatus {
  mode: string;
  subscriptionEnabled: boolean;
  connectedAt: string | null;
  hasApiKey: boolean;
  claudeCli: CliInfo;
}
export interface ProgressEvent {
  done: number;
  total: number;
  last: CaseResult;
  index: number;
}

export interface ProjectDetail {
  name: string;
  displayName: string;
  judge: string;
  dataset: { input: string; expected: string; tags?: string[]; description?: string | null }[];
}

// Multi-model comparison (matrix: rows = cases, columns = models)
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
  cells: MatrixCell[];
}
export interface MatrixResult {
  id: string;
  project: string;
  judgeModel: string;
  variants: MatrixVariant[];
  rows: MatrixRow[];
  summary: Array<{ key: string; label: string; pass: number; fail: number; errored: number; total: number; score: number }>;
}
export interface MatrixProgress {
  row: number;
  col: number;
  cell: MatrixCell;
  totalCells: number;
}
