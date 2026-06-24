import { useEffect, useRef, useState } from "react";
import { getProjects, getProjectDataset, importCases, runEvalStream } from "../api";
import type { ProjectInfo, RunResult, CaseResult } from "../types";
import ResultView from "../components/ResultView";

type Mode = "bot" | "prompt";
interface TabPatch {
  project?: string;
  mode?: Mode;
  systemPrompt?: string;
  answerModel?: string;
}

/** Build a partial RunResult from the live (filling-in) rows, so ResultView can
 * render it exactly like a finished run while the eval streams. */
function liveRun(results: CaseResult[], projectName: string, judge: string): RunResult {
  const done = results.filter((r) => !r.pending);
  const passed = done.filter((r) => !r.error && r.verdict.pass).length;
  const errored = done.filter((r) => r.error).length;
  const failed = done.length - passed - errored;
  const total = results.length;
  return {
    id: "",
    project: projectName,
    judgeModel: judge,
    startedAt: "",
    finishedAt: "",
    total,
    passed,
    failed,
    errored,
    // Live pass-rate is over GRADED cases, not the full dataset, so the header
    // doesn't read artificially low (e.g. "2%") while rows are still streaming.
    score: done.length ? Math.round((passed / done.length) * 100) : 0,
    results,
  };
}

const placeholder = (input = "", expected = "", tags: string[] = [], description?: string): CaseResult => ({
  input,
  expected,
  tags,
  description,
  answer: "",
  verdict: { pass: false, score: 0, reason: "" },
  pending: true,
});

export default function RunPage({
  initial,
  onChange,
}: {
  initial?: TabPatch;
  onChange?: (patch: TabPatch) => void;
} = {}) {
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<Mode>(initial?.mode ?? "bot");
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt ?? "");
  const [answerModel, setAnswerModel] = useState(initial?.answerModel ?? "haiku");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [live, setLive] = useState<CaseResult[] | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    getProjects()
      .then((p) => {
        setProjects(p);
        // Restore this tab's saved project if it still exists, else default to the first.
        const saved = initial?.project;
        const pick = saved && p.some((x) => x.name === saved) ? saved : p[0]?.name;
        if (pick) {
          setSelected(pick);
          // Only re-sync when a *saved* project went missing (stale label). Don't
          // auto-rename brand-new tabs (no saved project) — they keep "Eval N".
          if (saved && pick !== saved) onChange?.({ project: pick });
        }
      })
      .catch((e) => setError(String(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => () => abortRef.current?.abort(), []);

  const project = projects.find((p) => p.name === selected);
  const judge = project?.judge ?? "sonnet";

  function pickProject(name: string) {
    setSelected(name);
    onChange?.({ project: name });
  }
  function pickMode(m: Mode) {
    setMode(m);
    onChange?.({ mode: m });
  }
  function editSystemPrompt(v: string) {
    setSystemPrompt(v);
    onChange?.({ systemPrompt: v });
  }
  function pickAnswerModel(m: string) {
    setAnswerModel(m);
    onChange?.({ answerModel: m });
  }

  async function onImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-importing the same file
    if (!file || !selected) return;
    setNotice("Importing…");
    try {
      const n = file.name.toLowerCase();
      const format = n.endsWith(".yaml") || n.endsWith(".yml") ? "promptfoo" : "csv";
      const r = await importCases(selected, await file.text(), format);
      setNotice(
        r.added > 0
          ? `Imported ${r.added} case${r.added === 1 ? "" : "s"}${r.skipped ? `, skipped ${r.skipped} (blank/duplicate)` : ""}. Dataset now ${r.total}.`
          : r.warning || "No new cases added.",
      );
      setProjects(await getProjects()); // refresh case counts
    } catch (err) {
      setNotice("Import failed: " + (err instanceof Error ? err.message : String(err)));
    }
  }

  async function start() {
    setRunning(true);
    setRun(null);
    setError("");
    setProgress({ done: 0, total: project?.cases ?? 0 });

    // Seed correctly-sized blank rows immediately (so the row count + header total
    // are right even if the dataset prefetch fails), then enrich with the questions.
    const n = project?.cases ?? 0;
    setLive(n > 0 ? Array.from({ length: n }, () => placeholder()) : null);
    try {
      const detail = await getProjectDataset(selected);
      setLive(detail.dataset.map((d) => placeholder(d.input, d.expected, d.tags ?? [], d.description ?? undefined)));
    } catch {
      /* keep the correctly-sized blank placeholders; they fill in as cases complete */
    }

    const ac = new AbortController();
    abortRef.current = ac;
    const body =
      mode === "prompt"
        ? { project: selected, mode: "prompt" as const, systemPrompt, answerModel }
        : { project: selected };
    await runEvalStream(
      body,
      {
        onProgress: (p) => {
          setProgress({ done: p.done, total: p.total });
          setLive((cur) => {
            const arr = cur ? cur.slice() : [];
            if (typeof p.index === "number") {
              while (arr.length <= p.index) arr.push(placeholder());
              arr[p.index] = { ...p.last, pending: false };
            }
            return arr;
          });
        },
        onDone: (r) => {
          setRun(r);
          setLive(null);
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
    // Keep the already-graded rows on screen as a partial (read-only) result
    // instead of letting them vanish when the live view stops rendering.
    if (live && live.some((r) => !r.pending)) {
      setRun(liveRun(live, project?.displayName ?? selected, judge));
    }
    setLive(null);
    setRunning(false);
  }

  const pct = progress && progress.total ? (progress.done / progress.total) * 100 : 0;
  const promptEmpty = mode === "prompt" && !systemPrompt.trim();

  return (
    <div>
      <h1 className="page-title">🎯 Run Eval</h1>
      {error && <p className="err">{error}</p>}
      <div className="card">
        <div className="row">
          <label>Target</label>
          <span className="seg">
            <button
              type="button"
              className={mode === "bot" ? "on" : ""}
              disabled={running}
              onClick={() => pickMode("bot")}
            >
              Live bot
            </button>
            <button
              type="button"
              className={mode === "prompt" ? "on" : ""}
              disabled={running}
              onClick={() => pickMode("prompt")}
            >
              Prompt · $0
            </button>
          </span>
        </div>

        <div className="row">
          <label>{mode === "prompt" ? "Dataset" : "Project"}</label>
          <select value={selected} onChange={(e) => pickProject(e.target.value)} disabled={running}>
            {projects.map((p) => (
              <option key={p.name} value={p.name}>
                {p.displayName} ({p.cases} cases)
              </option>
            ))}
          </select>
          <button
            className="secondary"
            disabled={running || !selected}
            title="Import test cases — CSV (input, expected, tags, description) or a promptfoo eval .yaml"
            onClick={() => fileRef.current?.click()}
          >
            ⬆ Import CSV / promptfoo
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.yaml,.yml,text/csv,text/yaml"
            style={{ display: "none" }}
            onChange={onImportFile}
          />
        </div>
        {notice && (
          <div className="row">
            <label></label>
            <span className="muted">{notice}</span>
          </div>
        )}

        {mode === "prompt" && (
          <>
            <div className="row">
              <label>Model</label>
              <select value={answerModel} onChange={(e) => pickAnswerModel(e.target.value)} disabled={running}>
                <option value="haiku">haiku</option>
                <option value="sonnet">sonnet</option>
              </select>
            </div>
            <div className="row" style={{ alignItems: "flex-start" }}>
              <label style={{ paddingTop: 8 }}>System Prompt</label>
              <textarea
                className="sysprompt"
                rows={7}
                disabled={running}
                placeholder="You are Flabee Care, a friendly clinic assistant. Always quote prices as a range from the website. Reply in the customer's language…"
                value={systemPrompt}
                onChange={(e) => editSystemPrompt(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="row">
          <label>Judge</label>
          <span className="muted">Claude {judge}</span>
        </div>
        <div className="row">
          {!running ? (
            <button onClick={start} disabled={!selected || !!project?.error || promptEmpty}>
              ▶ Run
            </button>
          ) : (
            <button className="secondary" onClick={cancel}>
              Cancel
            </button>
          )}
          {promptEmpty && <span className="muted" style={{ marginLeft: 10 }}>Write a system prompt to run</span>}
        </div>
        {project?.error && <p className="err">Config error: {project.error}</p>}
        {running && progress && (
          <div>
            <div className="muted">
              Running… {mode === "prompt" ? "prompting + grading (subscription, $0)" : "asking the bot + grading"}
            </div>
            <div className="progress">
              <div style={{ width: `${pct}%` }} />
            </div>
            <div className="muted">
              {progress.done} / {progress.total}
            </div>
          </div>
        )}
      </div>

      {/* Live results — rows fill in as each case completes */}
      {running && live && live.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <ResultView run={liveRun(live, project?.displayName ?? selected, judge)} />
        </div>
      )}

      {/* Final results */}
      {run && (
        <div style={{ marginTop: 24 }}>
          <ResultView run={run} />
        </div>
      )}
    </div>
  );
}
