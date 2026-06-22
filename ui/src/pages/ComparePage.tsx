import { useEffect, useMemo, useState } from "react";
import { getRuns, getRun } from "../api";
import type { RunSummary, RunResult, CaseResult } from "../types";

/** Borrowed from the Anthropic Workbench's side-by-side eval comparison:
 * pick two runs (e.g. prompt v1 vs v2) and see, per case, what improved or
 * regressed — the "refine → re-test → compare" step of the prompt-eng loop. */

function runLabel(r: RunSummary): string {
  const when = r.startedAt ? r.startedAt.slice(0, 16).replace("T", " ") : "";
  return `${r.project} · ${r.score}% (${r.passed}/${r.total}) · ${when}`;
}

const passed = (c?: CaseResult) => !!c && !c.error && c.verdict.pass;

export default function ComparePage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [aId, setAId] = useState("");
  const [bId, setBId] = useState("");
  const [a, setA] = useState<RunResult | null>(null);
  const [b, setB] = useState<RunResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    getRuns()
      .then((rs) => {
        setRuns(rs);
        // Default to the two most recent (B = newest, A = previous) so the delta
        // reads "older → newer".
        if (rs[1]) {
          setAId(rs[1].id);
          setBId(rs[0].id);
        } else if (rs[0]) {
          setAId(rs[0].id);
          setBId(rs[0].id);
        }
      })
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (aId) getRun(aId).then(setA).catch(() => setA(null));
  }, [aId]);
  useEffect(() => {
    if (bId) getRun(bId).then(setB).catch(() => setB(null));
  }, [bId]);

  const rows = useMemo(() => {
    if (!a || !b) return [];
    const aBy = new Map(a.results.map((c) => [c.input, c]));
    const bBy = new Map(b.results.map((c) => [c.input, c]));
    // A's cases first (in order), then any cases only present in B.
    const inputs = [
      ...a.results.map((c) => c.input),
      ...b.results.filter((c) => !aBy.has(c.input)).map((c) => c.input),
    ];
    return inputs.map((input, i) => {
      const ca = aBy.get(input);
      const cb = bBy.get(input);
      const pa = passed(ca);
      const pb = passed(cb);
      let delta: "improved" | "regressed" | "same" | "na" = "na";
      if (ca && cb) delta = pa === pb ? "same" : pb ? "improved" : "regressed";
      return { i, input, ca, cb, pa, pb, delta };
    });
  }, [a, b]);

  const improved = rows.filter((r) => r.delta === "improved").length;
  const regressed = rows.filter((r) => r.delta === "regressed").length;
  const scoreDelta = a && b ? b.score - a.score : 0;

  const cell = (c: CaseResult | undefined, isPass: boolean) =>
    !c ? (
      <span className="muted">—</span>
    ) : c.error ? (
      <span className="pf-badge fail">ERROR</span>
    ) : (
      <span className={"pf-badge " + (isPass ? "pass" : "fail")}>
        {isPass ? "PASS" : "FAIL"} · {c.verdict.score}
      </span>
    );

  return (
    <div>
      <h1 className="page-title">⚖️ Compare runs</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Pick two runs (e.g. before vs after a prompt change) to see, per case, what improved or
        regressed.
      </p>
      {error && <p className="err">{error}</p>}

      <div className="card">
        <div className="row">
          <label>Run A</label>
          <select value={aId} onChange={(e) => setAId(e.target.value)} style={{ minWidth: 420 }}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r)}
              </option>
            ))}
          </select>
        </div>
        <div className="row">
          <label>Run B</label>
          <select value={bId} onChange={(e) => setBId(e.target.value)} style={{ minWidth: 420 }}>
            {runs.map((r) => (
              <option key={r.id} value={r.id}>
                {runLabel(r)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {a && b && (
        <>
          <div className="cmp-summary">
            <span className="pf-chip">A: {a.score}% ({a.passed}/{a.total})</span>
            <span className="cmp-arrow">→</span>
            <span className="pf-chip">B: {b.score}% ({b.passed}/{b.total})</span>
            <b className={scoreDelta > 0 ? "ok" : scoreDelta < 0 ? "warn" : "muted"}>
              {scoreDelta > 0 ? "+" : ""}
              {scoreDelta}%
            </b>
            <span className="cmp-up">⬆ {improved} improved</span>
            <span className="cmp-down">⬇ {regressed} regressed</span>
          </div>

          <table className="pf cmp">
            <thead>
              <tr className="pf-sub">
                <th className="pf-num">#</th>
                <th>Question</th>
                <th>Run A</th>
                <th>Run B</th>
                <th>Δ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.i}
                  className={
                    r.delta === "improved" ? "cmp-row-up" : r.delta === "regressed" ? "cmp-row-down" : ""
                  }
                >
                  <td className="pf-num">{r.i + 1}</td>
                  <td className="pf-msg">{r.input}</td>
                  <td>{cell(r.ca, r.pa)}</td>
                  <td>{cell(r.cb, r.pb)}</td>
                  <td>
                    {r.delta === "improved" && <span className="cmp-up">⬆</span>}
                    {r.delta === "regressed" && <span className="cmp-down">⬇</span>}
                    {r.delta === "same" && <span className="muted">=</span>}
                    {r.delta === "na" && <span className="muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
