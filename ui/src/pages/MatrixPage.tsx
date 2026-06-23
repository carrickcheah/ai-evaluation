import { useEffect, useRef, useState } from "react";
import { getProjects, getProjectDataset, runMatrixStream } from "../api";
import type { ProjectInfo, MatrixResult, MatrixRow, MatrixCell, MatrixVariant } from "../types";

const MODELS = ["haiku", "sonnet", "opus"];
const STORE_KEY = "matrix-cfg";

const pendingCell = (): MatrixCell => ({ answer: "", verdict: { pass: false, score: 0, reason: "" }, pending: true });

/** Per-column pass rate computed live from the rows (don't wait for the server summary). */
function columns(rows: MatrixRow[], variants: MatrixVariant[]) {
  return variants.map((v, c) => {
    const cells = rows.map((r) => r.cells[c]).filter((x): x is MatrixCell => !!x && !x.pending);
    const pass = cells.filter((x) => !x.error && x.verdict.pass).length;
    const total = cells.length;
    return { ...v, pass, total, score: total ? Math.round((pass / total) * 100) : 0 };
  });
}

export default function MatrixPage() {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [models, setModels] = useState<Record<string, boolean>>({ haiku: true, sonnet: true, opus: false });
  const [limit, setLimit] = useState("4");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [matrix, setMatrix] = useState<MatrixResult | null>(null);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    getProjects()
      .then((p) => {
        setProjects(p);
        if (p[0]) setSelected(p[0].name);
      })
      .catch((e) => setError(String(e)));
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
      if (typeof saved.systemPrompt === "string") setSystemPrompt(saved.systemPrompt);
      if (saved.models && typeof saved.models === "object") setModels(saved.models);
      if (typeof saved.limit === "string") setLimit(saved.limit);
    } catch {
      /* ignore corrupt storage */
    }
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);
  useEffect(() => {
    localStorage.setItem(STORE_KEY, JSON.stringify({ systemPrompt, models, limit }));
  }, [systemPrompt, models, limit]);

  const project = projects.find((p) => p.name === selected);
  const chosen = MODELS.filter((m) => models[m]);
  const canRun = !!selected && !project?.error && systemPrompt.trim() !== "" && chosen.length > 0;

  async function start() {
    setRunning(true);
    setError("");
    setMatrix(null);
    const lim = limit.trim() ? Math.max(1, Number(limit) || 0) : undefined;
    const total = lim ? Math.min(lim, project?.cases ?? lim) : project?.cases ?? 0;
    setProgress({ done: 0, total: total * chosen.length });

    // Pre-build the matrix from the dataset so all rows/cells show immediately.
    const variants: MatrixVariant[] = chosen.map((m) => ({ key: m, label: m, model: m }));
    let rows: MatrixRow[] = [];
    try {
      const detail = await getProjectDataset(selected);
      const ds = lim ? detail.dataset.slice(0, lim) : detail.dataset;
      rows = ds.map((d) => ({
        input: d.input,
        expected: d.expected,
        tags: d.tags ?? [],
        description: d.description ?? undefined,
        cells: variants.map(() => pendingCell()),
      }));
    } catch {
      /* fall back to empty; cells arrive via progress */
    }
    setMatrix({ id: "", project: selected, judgeModel: project?.judge ?? "sonnet", variants, rows, summary: [] });

    const ac = new AbortController();
    abortRef.current = ac;
    await runMatrixStream(
      { project: selected, systemPrompt, models: chosen, limit: lim },
      {
        onProgress: (p) => {
          setProgress((cur) => ({ done: (cur?.done ?? 0) + 1, total: cur?.total ?? p.totalCells }));
          setMatrix((m) => {
            if (!m) return m;
            const rows2 = m.rows.slice();
            const row = rows2[p.row];
            if (row) {
              const cells = row.cells.slice();
              cells[p.col] = { ...p.cell, pending: false };
              rows2[p.row] = { ...row, cells };
            }
            return { ...m, rows: rows2 };
          });
        },
        onDone: (r) => {
          setMatrix(r);
          setRunning(false);
        },
        onError: (msg) => {
          setError(msg);
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

  const cols = matrix ? columns(matrix.rows, matrix.variants) : [];
  const pct = progress && progress.total ? (progress.done / progress.total) * 100 : 0;

  function cell(c: MatrixCell | undefined) {
    if (!c || c.pending) return <span className="pf-badge pending">⏳</span>;
    if (c.error) return <span className="pf-badge fail" title={c.error}>ERROR</span>;
    const pass = !c.error && c.verdict.pass;
    return (
      <span
        className={"pf-badge " + (pass ? "pass" : "fail")}
        title={`${c.answer}\n\n— ${c.verdict.reason}`}
      >
        {pass ? "PASS" : "FAIL"} · {c.verdict.score}
      </span>
    );
  }

  return (
    <div>
      <h1 className="page-title">🆚 Compare models</h1>
      <p className="muted" style={{ maxWidth: 700 }}>
        Run the same cases against several models at once (Prompt mode, subscription · $0) and see
        each model's pass rate side-by-side.
      </p>
      {error && <p className="err">{error}</p>}

      <div className="card">
        <div className="row">
          <label>Dataset</label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} disabled={running}>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName} ({p.cases} cases)
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label>Models</label>
          <span className="modelboxes">
            {MODELS.map((m) => (
              <label key={m} className={"chk" + (models[m] ? " on" : "")}>
                <input
                  type="checkbox"
                  checked={!!models[m]}
                  disabled={running}
                  onChange={(e) => setModels((s) => ({ ...s, [m]: e.target.checked }))}
                />
                {m}
              </label>
            ))}
          </span>
        </div>
        <div className="row">
          <label>Limit</label>
          <input
            type="text"
            value={limit}
            disabled={running}
            onChange={(e) => setLimit(e.target.value.replace(/[^0-9]/g, ""))}
            style={{ minWidth: 80 }}
          />
          <span className="muted">first N cases (blank = all) · cells = cases × models</span>
        </div>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <label style={{ paddingTop: 8 }}>System Prompt</label>
          <textarea
            className="sysprompt"
            rows={6}
            disabled={running}
            placeholder="You are Flabee Care… (shared across all models)"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
          />
        </div>
        <div className="row">
          <label>Judge</label>
          <span className="muted">Claude {project?.judge ?? "sonnet"} · subscription</span>
        </div>
        <div className="row">
          {!running ? (
            <button onClick={start} disabled={!canRun}>
              ▶ Run comparison
            </button>
          ) : (
            <button className="secondary" onClick={cancel}>
              Cancel
            </button>
          )}
          {!canRun && !running && (
            <span className="muted" style={{ marginLeft: 10 }}>Pick a model + write a system prompt</span>
          )}
        </div>
        {running && progress && (
          <div>
            <div className="muted">Running… prompting + grading every cell (subscription · $0)</div>
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="muted">{progress.done} / {progress.total} cells</div>
          </div>
        )}
      </div>

      {matrix && matrix.rows.length > 0 && (
        <table className="pf mtx" style={{ marginTop: 22 }}>
          <thead>
            <tr className="pf-sub">
              <th className="pf-num">#</th>
              <th>Question</th>
              {cols.map((v) => (
                <th key={v.key}>
                  {v.label}
                  <div className="mtx-rate">
                    {v.total ? `${v.score}% (${v.pass}/${v.total})` : "—"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.rows.map((row, i) => (
              <tr key={i}>
                <td className="pf-num">{i + 1}</td>
                <td className="pf-msg">{row.input}</td>
                {row.cells.map((c, ci) => (
                  <td key={ci} className="mtx-cell">{cell(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
