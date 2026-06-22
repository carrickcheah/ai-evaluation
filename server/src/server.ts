/** HTTP API (Hono) for the eval tool: projects, run (SSE), run history,
 * and Claude-subscription status. The UI (Vite) proxies /api here in dev. */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { listProjects, loadProject } from "./config";
import { runEval } from "./run-eval";
import { askPrompt } from "./prompt-runner";
import { saveRun, listRuns, getRun, updateCase, migrateJsonRuns } from "./history";
import * as sub from "./subscription";
import type { ProjectConfig } from "./types";

migrateJsonRuns(); // one-time: import any legacy data/runs/*.json into SQLite

const app = new Hono();
app.use("/api/*", cors());

app.get("/api/health", (c) => c.json({ ok: true }));

app.get("/api/projects", (c) => {
  const projects = listProjects().map((name) => {
    try {
      const p = loadProject(name);
      return { name, displayName: p.name, cases: p.dataset.length, judge: p.judge.model, error: null };
    } catch (e) {
      return { name, displayName: name, cases: 0, judge: "", error: e instanceof Error ? e.message : String(e) };
    }
  });
  return c.json({ projects });
});

// Project detail (dataset only — no target/secrets) so the UI can pre-lay-out
// rows and fill them in live as the run streams.
app.get("/api/projects/:name", (c) => {
  try {
    const p = loadProject(c.req.param("name"));
    return c.json({
      name: p.name,
      displayName: p.name,
      judge: p.judge.model,
      dataset: p.dataset.map((d) => ({
        input: d.input,
        expected: d.expected,
        tags: d.tags ?? [],
        description: d.description ?? null,
      })),
    });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 404);
  }
});

app.get("/api/eval/runs", (c) => c.json({ runs: listRuns() }));

app.get("/api/eval/runs/:id", (c) => {
  const r = getRun(c.req.param("id"));
  return r ? c.json(r) : c.json({ error: "run not found" }, 404);
});

// Human review: persist a rating (👍/👎) / comment onto one case of a run.
app.patch("/api/eval/runs/:id/case/:index", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    rating?: "up" | "down" | null;
    comment?: string;
  };
  const index = Number(c.req.param("index"));
  if (!Number.isInteger(index) || index < 0) return c.json({ error: "bad index" }, 400);
  const updated = updateCase(c.req.param("id"), index, body);
  return updated ? c.json({ case: updated }) : c.json({ error: "run/case not found" }, 404);
});

app.post("/api/eval/run", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    project?: string;
    judgeModel?: string;
    limit?: number;
    mode?: "bot" | "prompt";
    systemPrompt?: string;
    answerModel?: string;
  };
  if (!body.project) return c.json({ error: "project is required" }, 400);
  // Prompt mode tests a system prompt you wrote (on the subscription) instead of
  // the live bot — so it needs a non-empty system prompt.
  if (body.mode === "prompt" && !body.systemPrompt?.trim()) {
    return c.json({ error: "systemPrompt is required in prompt mode" }, 400);
  }

  let project: ProjectConfig;
  try {
    project = loadProject(body.project);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  if (body.judgeModel) project = { ...project, judge: { ...project.judge, model: body.judgeModel } };
  if (body.limit && body.limit > 0) project = { ...project, dataset: project.dataset.slice(0, body.limit) };

  return streamSSE(c, async (stream) => {
    // Client disconnect (tab closed / Cancel) → abort the server-side eval too, so
    // we stop spending subscription/bot calls on a run nobody is reading.
    const controller = new AbortController();
    stream.onAbort(() => controller.abort());
    // Heartbeat so the socket never idles between slow cases (bot call + grade can
    // exceed the server idleTimeout). The UI ignores non progress/done/error events.
    const hb = setInterval(() => {
      stream.writeSSE({ event: "heartbeat", data: "hb" }).catch(() => {});
    }, 5_000);
    try {
      await stream.writeSSE({ event: "start", data: JSON.stringify({ total: project.dataset.length }) });
      // Prompt mode → answer each case from the system prompt on the subscription
      // ($0); otherwise answerFn stays undefined and runEval calls the live bot.
      const answerFn =
        body.mode === "prompt"
          ? (input: string) =>
              askPrompt(body.systemPrompt!, input, body.answerModel || "haiku", 120_000, controller.signal)
          : undefined;
      const run = await runEval(
        project,
        async (done, total, last, index) => {
          await stream.writeSSE({
            event: "progress",
            data: JSON.stringify({ done, total, last, index }),
          });
        },
        controller.signal,
        answerFn,
      );
      // Don't persist or announce a run the client abandoned (it's partial).
      if (!controller.signal.aborted) {
        saveRun(run);
        await stream.writeSSE({ event: "done", data: JSON.stringify(run) });
      }
    } catch (err) {
      if (!controller.signal.aborted) {
        await stream.writeSSE({
          event: "error",
          data: JSON.stringify({ message: err instanceof Error ? err.message : String(err) }),
        });
      }
    } finally {
      clearInterval(hb);
    }
  });
});

app.get("/api/subscription/status", async (c) => c.json(await sub.getStatus()));
app.post("/api/subscription/connect", async (c) => {
  try {
    return c.json(await sub.connect());
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
});

const port = Number(process.env.PORT) || 8787;
console.log(`ai-evaluation server → http://localhost:${port}`);

// idleTimeout max (255s) + the SSE heartbeat above keep long eval runs alive.
export default { port, idleTimeout: 255, fetch: app.fetch };
