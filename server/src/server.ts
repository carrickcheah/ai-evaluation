/** HTTP API (Hono) for the eval tool: projects, run (SSE), run history,
 * and Claude-subscription status. The UI (Vite) proxies /api here in dev. */
import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { listProjects, loadProject } from "./config";
import { runEval } from "./run-eval";
import { saveRun, listRuns, getRun } from "./history";
import * as sub from "./subscription";
import type { ProjectConfig } from "./types";

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

app.get("/api/eval/runs", (c) => c.json({ runs: listRuns() }));

app.get("/api/eval/runs/:id", (c) => {
  const r = getRun(c.req.param("id"));
  return r ? c.json(r) : c.json({ error: "run not found" }, 404);
});

app.post("/api/eval/run", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as {
    project?: string;
    judgeModel?: string;
    limit?: number;
  };
  if (!body.project) return c.json({ error: "project is required" }, 400);

  let project: ProjectConfig;
  try {
    project = loadProject(body.project);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
  if (body.judgeModel) project = { ...project, judge: { ...project.judge, model: body.judgeModel } };
  if (body.limit && body.limit > 0) project = { ...project, dataset: project.dataset.slice(0, body.limit) };

  return streamSSE(c, async (stream) => {
    // Heartbeat so the socket never idles between slow cases (bot call + grade can
    // exceed the server idleTimeout). The UI ignores non progress/done/error events.
    const hb = setInterval(() => {
      stream.writeSSE({ event: "heartbeat", data: "hb" }).catch(() => {});
    }, 5_000);
    try {
      await stream.writeSSE({ event: "start", data: JSON.stringify({ total: project.dataset.length }) });
      const run = await runEval(project, async (done, total, last) => {
        await stream.writeSSE({ event: "progress", data: JSON.stringify({ done, total, last }) });
      });
      saveRun(run);
      await stream.writeSSE({ event: "done", data: JSON.stringify(run) });
    } catch (err) {
      await stream.writeSSE({
        event: "error",
        data: JSON.stringify({ message: err instanceof Error ? err.message : String(err) }),
      });
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
app.post("/api/subscription/disconnect", async (c) => c.json(await sub.disconnect()));

const port = Number(process.env.PORT) || 8787;
console.log(`ai-evaluation server → http://localhost:${port}`);

// idleTimeout max (255s) + the SSE heartbeat above keep long eval runs alive.
export default { port, idleTimeout: 255, fetch: app.fetch };
