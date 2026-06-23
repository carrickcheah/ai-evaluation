import type { CaseResult } from "../types";

/** Small dependency-free charts for a run (borrowed from promptfoo's results view):
 * outcome breakdown, score distribution, and pass-rate by tag. Pure CSS bars. */
export default function ResultCharts({ results }: { results: CaseResult[] }) {
  const graded = results.filter((c) => !c.pending);
  if (graded.length === 0) return null;

  const pass = graded.filter((c) => !c.error && c.verdict.pass).length;
  const err = graded.filter((c) => c.error).length;
  const fail = graded.length - pass - err;
  const total = graded.length;

  // Score distribution (1..10) over graded, non-errored cases.
  const hist = Array.from({ length: 10 }, () => 0);
  graded
    .filter((c) => !c.error)
    .forEach((c) => {
      const s = Math.max(1, Math.min(10, Math.round(c.verdict.score)));
      hist[s - 1]++;
    });
  const histMax = Math.max(1, ...hist);

  // Pass rate per tag (untagged grouped together).
  const tagMap = new Map<string, { pass: number; total: number }>();
  graded.forEach((c) => {
    const ok = !c.error && c.verdict.pass;
    const tags = c.tags?.length ? c.tags : ["(untagged)"];
    tags.forEach((t) => {
      const e = tagMap.get(t) ?? { pass: 0, total: 0 };
      e.total++;
      if (ok) e.pass++;
      tagMap.set(t, e);
    });
  });
  const tags = [...tagMap.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 12);

  return (
    <div className="charts">
      <div className="chart">
        <div className="chart-title">Outcome · {Math.round((pass / total) * 100)}% pass</div>
        <div className="hbar">
          {pass > 0 && <span className="seg-pass" style={{ flexGrow: pass }} title={`${pass} pass`} />}
          {fail > 0 && <span className="seg-fail" style={{ flexGrow: fail }} title={`${fail} fail`} />}
          {err > 0 && <span className="seg-err" style={{ flexGrow: err }} title={`${err} error`} />}
        </div>
        <div className="chart-legend">
          <span><i className="dot dot-pass" /> {pass} pass</span>
          <span><i className="dot dot-fail" /> {fail} fail</span>
          {err > 0 && <span><i className="dot dot-err" /> {err} error</span>}
        </div>
      </div>

      <div className="chart">
        <div className="chart-title">Score distribution</div>
        <div className="vbars">
          {hist.map((n, i) => (
            <div key={i} className="vbar-col" title={`score ${i + 1}: ${n}`}>
              <div className="vbar" style={{ height: `${(n / histMax) * 100}%` }} />
              <span className="vbar-label">{i + 1}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="chart chart-wide">
        <div className="chart-title">Pass rate by tag</div>
        <div className="tagbars">
          {tags.map(([tag, v]) => {
            const pct = Math.round((v.pass / v.total) * 100);
            return (
              <div key={tag} className="tagbar">
                <span className="tagbar-name" title={tag}>{tag}</span>
                <span className="tagbar-track">
                  <span
                    className={"tagbar-fill " + (pct >= 70 ? "ok" : pct >= 40 ? "mid" : "low")}
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="tagbar-val">{pct}% ({v.pass}/{v.total})</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
