import type {
  RunResult,
  RunSummary,
  ProjectInfo,
  SubscriptionStatus,
  ProgressEvent,
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

export const getProjects = () =>
  jget<{ projects: ProjectInfo[] }>("/api/projects").then((r) => r.projects);
export const getRuns = () => jget<{ runs: RunSummary[] }>("/api/eval/runs").then((r) => r.runs);
export const getRun = (id: string) => jget<RunResult>(`/api/eval/runs/${encodeURIComponent(id)}`);
export const getSubscription = () => jget<SubscriptionStatus>("/api/subscription/status");
export const connectSubscription = () => jpost<SubscriptionStatus>("/api/subscription/connect");
export const disconnectSubscription = () => jpost<SubscriptionStatus>("/api/subscription/disconnect");

export interface RunHandlers {
  onProgress: (p: ProgressEvent) => void;
  onDone: (run: RunResult) => void;
  onError: (msg: string) => void;
}

/** POST /api/eval/run and parse the SSE stream over fetch (EventSource can't POST). */
export async function runEvalStream(
  body: { project: string; judgeModel?: string; limit?: number },
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
      else if (event === "done") h.onDone(parsed as RunResult);
      else if (event === "error") h.onError((parsed as { message?: string }).message ?? "error");
    }
  }
}
