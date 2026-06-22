import { useMemo, useState } from "react";
import type { RunResult } from "../types";

export default function ResultView({ run }: { run: RunResult }) {
  const [failedOnly, setFailedOnly] = useState(false);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return run.results
      .map((c, i) => ({ c, n: i + 1 }))
      .filter(({ c }) => {
        const failed = !c.verdict.pass || !!c.error;
        if (failedOnly && !failed) return false;
        if (
          needle &&
          !`${c.description ?? ""} ${c.input} ${c.answer} ${c.verdict.reason}`
            .toLowerCase()
            .includes(needle)
        )
          return false;
        return true;
      });
  }, [run, failedOnly, q]);

  function download(filename: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
  function exportCsv() {
    const esc = (v: unknown) => `"${String(v).replace(/"/g, '""')}"`;
    const header = ["#", "description", "input", "pass", "score", "bot_answer", "expected", "judge_reason", "latency_ms"];
    const lines = run.results.map((c, i) =>
      [
        i + 1,
        c.description ?? "",
        c.input,
        c.verdict.pass && !c.error,
        c.verdict.score,
        c.answer,
        c.expected,
        c.error ? `ERROR: ${c.error}` : c.verdict.reason,
        c.latencyMs ?? "",
      ]
        .map(esc)
        .join(","),
    );
    download(`${run.id}.csv`, [header.map(esc).join(","), ...lines].join("\n"), "text/csv");
  }

  return (
    <div>
      <div className="toolbar">
        <button className="secondary" onClick={() => setFailedOnly((f) => !f)}>
          {failedOnly ? "Show all" : `❌ Failed only (${run.failed + run.errored})`}
        </button>
        <input
          type="text"
          placeholder="🔍 search…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <span className="muted">
          {rows.length} / {run.total}
        </span>
        <button className="secondary" style={{ marginLeft: "auto" }} onClick={exportCsv}>
          ⬇ Export CSV
        </button>
      </div>

      <table className="pf">
        <colgroup>
          <col style={{ width: "46px" }} />
          <col style={{ width: "26%" }} />
          <col style={{ width: "27%" }} />
          <col />
        </colgroup>
        <thead>
          <tr className="pf-grp">
            <th></th>
            <th></th>
            <th>Variables</th>
            <th>
              Outputs
              <div className="pf-summary">
                <span className="pf-chip">e2e · {run.project}</span>
                <b className={run.score >= 90 ? "ok" : "warn"}>{run.score}% passing</b>
                <span className="muted">
                  ({run.passed}/{run.total} cases)
                </span>
                <span className="pf-chip">judge: {run.judgeModel}</span>
              </div>
            </th>
          </tr>
          <tr className="pf-sub">
            <th className="pf-num">#</th>
            <th>Description</th>
            <th>message</th>
            <th>{"{{message}}"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, n }) => {
            const failed = !c.verdict.pass || !!c.error;
            return (
              <tr key={n}>
                <td className="pf-num">{n}</td>
                <td className="pf-desc">{c.description ?? c.input}</td>
                <td className="pf-msg">{c.input}</td>
                <td className="pf-out">
                  <div className="pf-out-head">
                    <span className={"pf-badge " + (failed ? "fail" : "pass")}>
                      {failed ? `1 FAIL (${(c.verdict.score / 10).toFixed(2)})` : "1 PASS"}
                    </span>
                    <span className="pf-icons" aria-hidden="true">
                      👍 👎 # ✎ 🔍
                    </span>
                  </div>
                  {failed && (
                    <div className="pf-reason">
                      {c.error ? `ERROR: ${c.error}` : c.verdict.reason}
                    </div>
                  )}
                  <div className={"pf-answer" + (failed ? "" : " pass")}>
                    {c.answer || "(no answer)"}
                  </div>
                  {typeof c.latencyMs === "number" && (
                    <div className="pf-latency">Latency: {(c.latencyMs / 1000).toFixed(1)}s</div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
