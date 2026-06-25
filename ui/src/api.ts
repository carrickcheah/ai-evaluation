import type {
  RunResult,
  RunSummary,
  ProjectInfo,
  SubscriptionStatus,
  ProgressEvent,
  CaseResult,
  ProjectDetail,
  MatrixResult,
  MatrixProgress,
} from "./types";

async function jget<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  return (await r.json()) as T;
}
async function jpost<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || `POST ${url} → ${r.status}`);
  return data;
}

async function jpatch<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(data.error || `PATCH ${url} → ${r.status}`);
  return data;
}

export const rateCase = (
  runId: string,
  index: number,
  patch: { rating?: "up" | "down" | null; comment?: string },
) =>
  jpatch<{ case: CaseResult }>(
    `/api/eval/runs/${encodeURIComponent(runId)}/case/${index}`,
    patch,
  ).then((r) => r.case);

export const getProjects = () =>
  jget<{ projects: ProjectInfo[] }>("/api/projects").then((r) => r.projects);
export const getProjectDataset = (name: string) =>
  jget<ProjectDetail>(`/api/projects/${encodeURIComponent(name)}`);
export const importCases = (name: string, content: string, format?: "csv" | "promptfoo") =>
  jpost<{ added: number; skipped: number; total: number; warning?: string }>(
    `/api/projects/${encodeURIComponent(name)}/import`,
    { content, format },
  );
export interface Connection {
  id: string;
  name: string;
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
  answerPath: string;
}
export const getConnections = () =>
  jget<{ connections: Connection[] }>("/api/connections").then((r) => r.connections);
export const saveConnection = (conn: Partial<Connection>) =>
  jpost<Connection>("/api/connections", conn);
export const deleteConnection = async (id: string) => {
  const r = await fetch(`/api/connections/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `delete → ${r.status}`);
};

export const createDataset = (
  name: string,
  content: string,
  format?: "csv" | "promptfoo",
  rubric?: string,
) =>
  jpost<{ name: string; displayName: string; total: number }>("/api/projects/create", {
    name,
    content,
    format,
    rubric,
  });
export const getRuns = () => jget<{ runs: RunSummary[] }>("/api/eval/runs").then((r) => r.runs);
export const getRun = (id: string) => jget<RunResult>(`/api/eval/runs/${encodeURIComponent(id)}`);
export const getSubscription = () => jget<SubscriptionStatus>("/api/subscription/status");
export const connectSubscription = () => jpost<SubscriptionStatus>("/api/subscription/connect");

export interface RunHandlers {
  onProgress: (p: ProgressEvent) => void;
  onDone: (run: RunResult) => void;
  onError: (msg: string) => void;
}

/** POST /api/eval/run and parse the SSE stream over fetch (EventSource can't POST). */
export async function runEvalStream(
  body: {
    project: string;
    judgeModel?: string;
    limit?: number;
    mode?: "bot" | "prompt";
    systemPrompt?: string;
    answerModel?: string;
    connectionId?: string;
  },
  h: RunHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/eval/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) return; // user cancelled — not an error
    h.onError(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    h.onError(txt || `HTTP ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let terminal = false; // saw a done/error event
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (signal?.aborted) return; // user cancelled — not an error
      h.onError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const block of parts) {
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          // SSE: drop "data:" + one optional leading space; multiple data lines join with \n
          let v = line.slice(5);
          if (v.startsWith(" ")) v = v.slice(1);
          data += (data ? "\n" : "") + v;
        }
      }
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "progress") h.onProgress(parsed as ProgressEvent);
      else if (event === "done") {
        terminal = true;
        h.onDone(parsed as RunResult);
      } else if (event === "error") {
        terminal = true;
        h.onError((parsed as { message?: string }).message ?? "error");
      }
    }
  }
  // Stream ended (clean EOF) without a done/error event — e.g. the server restarted
  // or a proxy timed out mid-run. Surface it so the UI doesn't spin "running" forever.
  if (!terminal && !signal?.aborted) {
    h.onError("connection closed before the run finished");
  }
}

export interface MatrixHandlers {
  onStart?: (s: { cases: number; models: string[] }) => void;
  onProgress: (p: MatrixProgress) => void;
  onDone: (result: MatrixResult) => void;
  onError: (msg: string) => void;
}

/** POST /api/eval/run-matrix and parse its SSE stream (multi-model comparison). */
export async function runMatrixStream(
  body: { project: string; systemPrompt: string; models: string[]; limit?: number },
  h: MatrixHandlers,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch("/api/eval/run-matrix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (e) {
    if (signal?.aborted) return;
    h.onError(e instanceof Error ? e.message : String(e));
    return;
  }
  if (!res.ok || !res.body) {
    const txt = await res.text().catch(() => "");
    h.onError(txt || `HTTP ${res.status}`);
    return;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let terminal = false;
  for (;;) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (e) {
      if (signal?.aborted) return;
      h.onError(e instanceof Error ? e.message : String(e));
      return;
    }
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop() ?? "";
    for (const block of parts) {
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event:")) {
          event = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          let v = line.slice(5);
          if (v.startsWith(" ")) v = v.slice(1);
          data += (data ? "\n" : "") + v;
        }
      }
      if (!data) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }
      if (event === "start") h.onStart?.(parsed as { cases: number; models: string[] });
      else if (event === "progress") h.onProgress(parsed as MatrixProgress);
      else if (event === "done") {
        terminal = true;
        h.onDone(parsed as MatrixResult);
      } else if (event === "error") {
        terminal = true;
        h.onError((parsed as { message?: string }).message ?? "error");
      }
    }
  }
  if (!terminal && !signal?.aborted) {
    h.onError("connection closed before the run finished");
  }
}
