import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { getRuns, getRun } from "../api";
import type { RunSummary, RunResult } from "../types";
import ResultView from "../components/ResultView";

export default function HistoryPage() {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [error, setError] = useState("");
  const nav = useNavigate();

  useEffect(() => {
    getRuns().then(setRuns).catch((e) => setError(String(e)));
  }, []);

  return (
    <div>
      <h1 className="page-title">📊 History</h1>
      {error && <p className="err">{error}</p>}
      {runs.length === 0 && !error ? (
        <p className="muted">No runs yet — run an eval first.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>When</th>
              <th>Project</th>
              <th>Judge</th>
              <th>Score</th>
              <th>Pass / Total</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => nav(`/history/${r.id}`)}>
                <td>{new Date(r.startedAt).toLocaleString()}</td>
                <td>{r.project}</td>
                <td className="muted">{r.judgeModel}</td>
                <td>{r.score}%</td>
                <td>
                  {r.passed} / {r.total}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function HistoryDetail() {
  const { id } = useParams();
  const [run, setRun] = useState<RunResult | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!id) return;
    let ignore = false;
    setRun(null);
    setError("");
    getRun(id)
      .then((r) => {
        if (!ignore) setRun(r);
      })
      .catch((e) => {
        if (!ignore) setError(String(e));
      });
    return () => {
      ignore = true;
    };
  }, [id]);

  return (
    <div>
      <h1 className="page-title">
        <Link to="/history" className="muted">
          ← History
        </Link>{" "}
        / Result
      </h1>
      {error && <p className="err">{error}</p>}
      {run ? <ResultView run={run} /> : !error && <p className="muted">Loading…</p>}
    </div>
  );
}
