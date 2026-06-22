import { useEffect, useRef, useState } from "react";
import { getProjects, runEvalStream } from "../api";
import type { ProjectInfo, RunResult } from "../types";
import ResultView from "../components/ResultView";

export default function RunPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getProjects()
      .then((p) => {
        setProjects(p);
        if (p[0]) setSelected(p[0].name);
      })
      .catch((e) => setError(String(e)));
  }, []);

  // Abort any in-flight run if the user navigates away mid-run.
  useEffect(() => () => abortRef.current?.abort(), []);

  const project = projects.find((p) => p.name === selected);

  async function start() {
    setRunning(true);
    setRun(null);
    setError("");
    setProgress({ done: 0, total: project?.cases ?? 0 });
    const ac = new AbortController();
    abortRef.current = ac;
    await runEvalStream(
      { project: selected },
      {
        onProgress: (p) => setProgress({ done: p.done, total: p.total }),
        onDone: (r) => {
          setRun(r);
          setRunning(false);
        },
        onError: (m) => {
          setError(m);
          setRunning(false);
        },
      },
      ac.signal,
    );
  }

  function cancel() {
    abortRef.current?.abort();
    setRunning(false);
  }

  const pct = progress && progress.total ? (progress.done / progress.total) * 100 : 0;

  return (
    <div>
      <h1 className="page-title">🎯 Run Eval</h1>
      {error && <p className="err">{error}</p>}
      <div className="card">
        <div className="row">
          <label>Project</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={running}>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName} ({p.cases} cases)
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label>Judge</label>
          <span className="muted">Claude {project?.judge ?? "sonnet"} · subscription</span>
        </div>
        <div className="row">
          {!running ? (
            <button onClick={start} disabled={!selected || !!project?.error}>
              ▶ Run
            </button>
          ) : (
            <button className="secondary" onClick={cancel}>
              Cancel
            </button>
          )}
        </div>
        {project?.error && <p className="err">Config error: {project.error}</p>}
        {running && progress && (
          <div>
            <div className="muted">Running… asking the bot + grading</div>
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="muted">
              {progress.done} / {progress.total}
            </div>
          </div>
        )}
      </div>
      {run && (
        <div style={{ marginTop: 24 }}>
          <ResultView run={run} />
        </div>
      )}
    </div>
  );
}
