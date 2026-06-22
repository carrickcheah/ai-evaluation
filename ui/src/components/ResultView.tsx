import { useEffect, useMemo, useState } from "react";
import type { CaseResult, RunResult } from "../types";
import { rateCase } from "../api";

export default function ResultView({ run }: { run: RunResult }) {
  // A live/partial run has no id yet (RunPage builds it). Rating/commenting/copying
  // would PATCH "/api/eval/runs//case/…" (404) and get wiped on the next stream tick,
  // so those controls are read-only until the run is saved and has an id.
  const live = !run.id;
  const [results, setResults] = useState<CaseResult[]>(run.results);
  const [failedOnly, setFailedOnly] = useState(false);
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
          {rows.map(({ c, n, idx }) => {
            const pending = !!c.pending;
            const failed = !pending && (!c.verdict.pass || !!c.error);
            return (
              <tr key={idx} className={pending ? "pf-pending" : ""}>
                <td className="pf-num">{n}</td>
                <td className="pf-desc">{c.description ?? c.input}</td>
                <td className="pf-msg">{c.input}</td>
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
