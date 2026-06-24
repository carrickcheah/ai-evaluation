import { useEffect, useMemo, useState } from "react";
import type { CaseResult, RunResult } from "../types";
import { rateCase } from "../api";
import ResultCharts from "./ResultCharts";

export default function ResultView({ run }: { run: RunResult }) {
  // A live/partial run has no id yet (RunPage builds it). Rating/commenting/copying
  // would PATCH "/api/eval/runs//case/…" (404) and get wiped on the next stream tick,
  // so those controls are read-only until the run is saved and has an id.
  const live = !run.id;
  const [results, setResults] = useState<CaseResult[]>(run.results);
  const [failedOnly, setFailedOnly] = useState(false);
  const [showExpected, setShowExpected] = useState(true);
  const [showCharts, setShowCharts] = useState(true);
  const [q, setQ] = useState("");
  const [copied, setCopied] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ c: CaseResult; n: number } | null>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => setResults(run.results), [run]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return results
      .map((c, idx) => ({ c, n: idx + 1, idx }))
      .filter(({ c }) => {
        const failed = !c.pending && (!c.verdict.pass || !!c.error);
        if (failedOnly && !failed) return false;
        if (
          needle &&
          !`${c.description ?? ""} ${c.input} ${c.answer} ${c.verdict.reason} ${c.comment ?? ""}`
            .toLowerCase()
            .includes(needle)
        )
          return false;
        return true;
      });
  }, [results, failedOnly, q]);

  async function patchCase(idx: number, patch: { rating?: "up" | "down" | null; comment?: string }) {
    setResults((rs) => rs.map((c, i) => (i === idx ? { ...c, ...patch } : c))); // optimistic
    try {
      const updated = await rateCase(run.id, idx, patch);
      setResults((rs) => rs.map((c, i) => (i === idx ? updated : c)));
    } catch {
      /* keep optimistic value if persistence fails */
    }
  }

  function copyLink(idx: number) {
    const url = `${location.origin}/history/${run.id}`;
    navigator.clipboard
      ?.writeText(url)
      .then(() => {
        setCopied(idx);
        setTimeout(() => setCopied((c) => (c === idx ? null : c)), 1500);
      })
      .catch(() => {});
  }

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
    const header = ["#", "description", "input", "pass", "score", "bot_answer", "expected", "judge_reason", "latency_ms", "rating", "comment"];
    const lines = results.map((c, i) =>
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
        c.rating ?? "",
        c.comment ?? "",
      ]
        .map(esc)
        .join(","),
    );
    download(`${run.id}.csv`, [header.map(esc).join(","), ...lines].join("\n"), "text/csv");
  }
  function exportHtml() {
    const esc = (v: unknown) =>
      String(v ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const rows = results
      .map((c, i) => {
        const failed = !c.verdict.pass || !!c.error;
        const score = (c.verdict.score / 10).toFixed(2);
        const reason = c.error ? `ERROR: ${c.error}` : c.verdict.reason;
        const badge = failed
          ? `<span class="badge fail">✕ FAIL</span><span class="sc">${score}</span>`
          : `<span class="badge pass">✓ PASS</span><span class="sc">${score}</span>`;
        return `<tr class="${failed ? "fail" : "pass"}">
  <td class="num">${i + 1}</td>
  <td class="desc">${esc(c.description ?? c.input)}</td>
  <td class="q">${esc(c.input)}</td>
  <td class="ideal">${esc(c.expected || "—")}</td>
  <td class="ans">${esc(c.answer || "(no answer)")}${reason ? `<div class="reason">${esc(reason)}</div>` : ""}</td>
  <td class="verdict">${badge}</td>
</tr>`;
      })
      .join("\n");
    const scoreClass = run.score >= 90 ? "ok" : run.score >= 60 ? "mid" : "low";
    const when = run.finishedAt ? new Date(run.finishedAt).toLocaleString() : "";
    const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(run.project)} — eval report</title>
<style>
  :root {
    --bg:#ebdbbc; --card:#f4ead2; --ink:#3a3128; --muted:#7a6c55; --line:#d6c39b;
    --pass:#2f8f57; --fail:#c0392b; --warn:#b8770a; --accent:#cc785c; --ideal:#ede1c0; --ideal-bd:#cc785c;
  }
  * { box-sizing: border-box; }
  body { font: 14px/1.6 ui-sans-serif, -apple-system, system-ui, "Segoe UI", sans-serif;
    margin:0; color:var(--ink); background:var(--bg); -webkit-font-smoothing:antialiased; }
  .wrap { max-width:none; margin:0; padding:28px 32px 64px; }
  header { background:linear-gradient(135deg,#cc785c,#b35e40); color:#fdf4e3; border-radius:18px;
    padding:26px 30px; box-shadow:0 10px 26px rgba(179,94,64,.28); margin-bottom:22px; }
  header .eyebrow { text-transform:uppercase; letter-spacing:.12em; font-size:11px; font-weight:700; opacity:.9; }
  header h1 { font-size:26px; margin:4px 0 10px; font-weight:800; letter-spacing:-.02em; }
  header .sub { font-size:13px; opacity:.92; }
  header .sub b { font-weight:700; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:14px; margin-bottom:22px; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:14px; padding:16px 18px;
    box-shadow:0 1px 2px rgba(58,49,40,.06); }
  .card .k { font-size:12px; color:var(--muted); font-weight:600; text-transform:uppercase; letter-spacing:.04em; }
  .card .v { font-size:28px; font-weight:800; margin-top:4px; letter-spacing:-.02em; }
  .card.big .v { font-size:38px; }
  .v.ok{color:var(--pass)} .v.mid{color:var(--warn)} .v.low{color:var(--fail)}
  .v.passc{color:var(--pass)} .v.failc{color:var(--fail)} .v.errc{color:var(--warn)}
  .bar { height:12px; border-radius:99px; background:#dcc699; overflow:hidden; margin:18px 0 26px; box-shadow:inset 0 1px 2px rgba(58,49,40,.12); }
  .bar > i { display:block; height:100%; background:linear-gradient(90deg,#3aa56a,#2f8f57); border-radius:99px; }
  .tablecard { background:var(--card); border:1px solid var(--line); border-radius:16px; overflow:hidden;
    box-shadow:0 4px 16px rgba(58,49,40,.08); }
  table { border-collapse:collapse; width:100%; font-size:13px; }
  thead th { background:#e7d6ab; color:var(--muted); text-transform:uppercase; letter-spacing:.05em;
    font-size:11px; font-weight:700; text-align:left; padding:12px 14px; position:sticky; top:0;
    border-bottom:1px solid var(--line); }
  td { padding:13px 14px; vertical-align:top; border-bottom:1px solid var(--line); }
  tbody tr:last-child td { border-bottom:none; }
  tr.fail { background:#eed9bd; }
  tr:hover { background:#ecdbb8; }
  td.num { text-align:center; color:var(--muted); font-variant-numeric:tabular-nums; width:40px; font-weight:600; }
  td.desc { color:var(--muted); max-width:180px; font-size:12px; }
  td.q { font-weight:600; max-width:220px; }
  td.ideal { background:var(--ideal); border-left:3px solid var(--ideal-bd); max-width:260px; color:var(--ink); }
  td.ans { max-width:340px; }
  td.verdict { white-space:nowrap; width:108px; }
  .reason { margin-top:8px; color:var(--muted); font-size:12px; font-style:italic;
    border-left:2px solid var(--line); padding-left:8px; }
  .badge { display:inline-block; padding:3px 10px; border-radius:7px; font-weight:700; font-size:11px; letter-spacing:.02em; color:#fdf4e3; }
  .badge.pass { background:var(--pass); } .badge.fail { background:#8e2f2f; }
  .sc { display:block; margin-top:5px; color:var(--muted); font-size:11px; font-variant-numeric:tabular-nums; }
  footer { text-align:center; color:var(--muted); font-size:12px; margin-top:24px; }
  @media print { body{background:#fff} header{box-shadow:none} .tablecard{box-shadow:none} tr:hover{background:none} }
</style></head><body>
<div class="wrap">
  <header>
    <div class="eyebrow">⚡ ai-eval report</div>
    <h1>${esc(run.project)}</h1>
    <div class="sub">Judge <b>${esc(run.judgeModel)}</b> &nbsp;•&nbsp; Run <b>${esc(run.id)}</b>${when ? ` &nbsp;•&nbsp; ${esc(when)}` : ""}</div>
  </header>

  <div class="cards">
    <div class="card big"><div class="k">Pass rate</div><div class="v ${scoreClass}">${run.score}%</div></div>
    <div class="card"><div class="k">Passed</div><div class="v passc">${run.passed}</div></div>
    <div class="card"><div class="k">Failed</div><div class="v failc">${run.failed}</div></div>
    <div class="card"><div class="k">Errored</div><div class="v errc">${run.errored}</div></div>
    <div class="card"><div class="k">Total cases</div><div class="v">${run.total}</div></div>
  </div>

  <div class="bar"><i style="width:${run.total ? Math.round((run.passed / run.total) * 100) : 0}%"></i></div>

  <div class="tablecard">
  <table>
  <thead><tr><th>#</th><th>Description</th><th>Question</th><th>🎯 Ideal answer</th><th>Bot answer</th><th>Verdict</th></tr></thead>
  <tbody>
${rows}
  </tbody></table>
  </div>

  <footer>Generated by ai-eval${when ? ` · ${esc(when)}` : ""}</footer>
</div>
</body></html>`;
    download(`${run.id}.html`, html, "text/html");
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
        <button
          className={"secondary" + (showCharts ? " on" : "")}
          onClick={() => setShowCharts((s) => !s)}
        >
          {showCharts ? "Hide charts" : "📊 Charts"}
        </button>
        <button
          className={"secondary" + (showExpected ? " on" : "")}
          style={{ marginLeft: "auto" }}
          onClick={() => setShowExpected((s) => !s)}
        >
          {showExpected ? "Hide ideal" : "🎯 Show ideal"}
        </button>
        <button className="secondary" onClick={exportCsv}>
          ⬇ Export CSV
        </button>
        <button className="secondary" onClick={exportHtml}>
          ⬇ Export HTML
        </button>
      </div>

      {showCharts && <ResultCharts results={results} />}

      <table className="pf">
        <colgroup>
          <col style={{ width: "46px" }} />
          <col style={{ width: showExpected ? "20%" : "26%" }} />
          <col style={{ width: showExpected ? "22%" : "27%" }} />
          {showExpected && <col style={{ width: "24%" }} />}
          <col />
        </colgroup>
        <thead>
          <tr className="pf-grp">
            <th></th>
            <th></th>
            <th colSpan={showExpected ? 2 : 1}>Variables</th>
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
            {showExpected && <th>🎯 Ideal answer</th>}
            <th>{"{{message}}"}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ c, n, idx }) => {
            const pending = !!c.pending;
            const failed = !pending && (!c.verdict.pass || !!c.error);
            return (
              <tr key={idx} className={pending ? "pf-pending" : ""}>
                <td className="pf-num">{n}</td>
                <td className="pf-desc">{c.description ?? c.input}</td>
                <td className="pf-msg">{c.input}</td>
                {showExpected && <td className="pf-msg pf-ideal-col">{c.expected || "—"}</td>}
                <td className="pf-out">
                  {pending ? (
                    <span className="pf-badge pending">⏳ running…</span>
                  ) : (
                    <>
                  <div className="pf-out-head">
                    <span className={"pf-badge " + (failed ? "fail" : "pass")}>
                      {failed ? `1 FAIL (${(c.verdict.score / 10).toFixed(2)})` : "1 PASS"}
                    </span>
                    <span className="pf-icons">
                      {!live && (
                        <>
                          <button
                            className={"icn" + (c.rating === "up" ? " on-up" : "")}
                            title="Good"
                            onClick={() => patchCase(idx, { rating: c.rating === "up" ? null : "up" })}
                          >
                            👍
                          </button>
                          <button
                            className={"icn" + (c.rating === "down" ? " on-down" : "")}
                            title="Bad"
                            onClick={() => patchCase(idx, { rating: c.rating === "down" ? null : "down" })}
                          >
                            👎
                          </button>
                          <button
                            className={"icn" + (c.comment ? " on" : "")}
                            title="Comment"
                            onClick={() => {
                              setDraft(c.comment || "");
                              setEditingIdx((e) => (e === idx ? null : idx));
                            }}
                          >
                            💬
                          </button>
                          <button className="icn" title="Copy link" onClick={() => copyLink(idx)}>
                            {copied === idx ? "✓" : "🔗"}
                          </button>
                        </>
                      )}
                      <button className="icn" title="Details" onClick={() => setDetail({ c, n })}>
                        🔍
                      </button>
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
                  {c.comment && <div className="pf-comment">💬 {c.comment}</div>}
                  {editingIdx === idx && (
                    <div className="pf-comment-edit">
                      <textarea
                        rows={2}
                        placeholder="Add a comment…"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        autoFocus
                      />
                      <div className="pf-comment-actions">
                        <button
                          onClick={() => {
                            patchCase(idx, { comment: draft });
                            setEditingIdx(null);
                          }}
                        >
                          Save
                        </button>
                        <button className="secondary" onClick={() => setEditingIdx(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                  {typeof c.latencyMs === "number" && (
                    <div className="pf-latency">Latency: {(c.latencyMs / 1000).toFixed(1)}s</div>
                  )}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {detail && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <b>
                #{detail.n} · {detail.c.description ?? detail.c.input}
              </b>
              <button className="icn" title="Close" onClick={() => setDetail(null)}>
                ✕
              </button>
            </div>
            <div className="modal-body">
              <div className="kv">
                <b>Question</b>
                {detail.c.input}
              </div>
              <div className="kv">
                <b>Bot answer</b>
                <div className="pf-answer">{detail.c.answer || "(no answer)"}</div>
              </div>
              <div className="kv">
                <b>Expected</b>
                {detail.c.expected}
              </div>
              <div className="kv">
                <b>Verdict</b>
                {detail.c.error
                  ? `ERROR: ${detail.c.error}`
                  : `${detail.c.verdict.pass ? "PASS" : "FAIL"} · ${detail.c.verdict.score}/10`}
              </div>
              {!detail.c.error && (
                <div className="kv">
                  <b>Judge reasoning</b>
                  {detail.c.verdict.reason}
                </div>
              )}
              {typeof detail.c.latencyMs === "number" && (
                <div className="kv">
                  <b>Latency</b>
                  {(detail.c.latencyMs / 1000).toFixed(1)}s
                </div>
              )}
              {detail.c.tags.length > 0 && (
                <div className="kv">
                  <b>Tags</b>
                  {detail.c.tags.join(", ")}
                </div>
              )}
              {detail.c.comment && (
                <div className="kv">
                  <b>Comment</b>
                  {detail.c.comment}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
