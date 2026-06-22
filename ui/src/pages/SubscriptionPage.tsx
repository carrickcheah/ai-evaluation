import { useEffect, useState } from "react";
import { getSubscription, connectSubscription } from "../api";
import type { SubscriptionStatus } from "../types";

export default function SubscriptionPage() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getSubscription()
      .then(setStatus)
      .catch((e) => setError(String(e)));
  }, []);

  async function act(fn: () => Promise<SubscriptionStatus>) {
    setBusy(true);
    setError("");
    try {
      setStatus(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(false);
  }

  return (
    <div>
      <h1 className="page-title">🔌 Connect Subscription</h1>
      <p className="muted" style={{ maxWidth: 680 }}>
        Grading runs on your local Claude subscription — no API tokens, no per-test billing.
        Credentials never leave this machine.
      </p>
      {error && <p className="err">{error}</p>}
      <div className="card">
        <div className="row">
          <label>claude CLI</label>
          <span>{status?.claudeCli.detected ? "✅ Detected" : "❌ Not found"}</span>
        </div>
        {status?.claudeCli.detected && (
          <div className="row">
            <label></label>
            <span className="muted">
              {status.claudeCli.path} · {status.claudeCli.version}
            </span>
          </div>
        )}
        <div className="row">
          <label>API key</label>
          <span className="muted">
            {status?.hasApiKey ? "set (ignored — subscription only)" : "not set ✅"}
          </span>
        </div>
        <div className="row">
          <label>Status</label>
          <span>
            {status?.subscriptionEnabled ? (
              <span className="pill pass">● Connected</span>
            ) : (
              <span className="muted">not available</span>
            )}
          </span>
        </div>
        {status?.subscriptionEnabled && (
          <div className="row">
            <label></label>
            <span className="muted" style={{ maxWidth: 520 }}>
              Grading runs on your local <code>claude</code> CLI — no toggle needed, no API tokens.
              {status.connectedAt
                ? ` Last verified ${new Date(status.connectedAt).toLocaleString()}.`
                : ""}
            </span>
          </div>
        )}
        <div className="row">
          <button
            disabled={busy || !status?.claudeCli.detected}
            onClick={() => act(connectSubscription)}
          >
            {busy ? "Verifying…" : "Verify connection"}
          </button>
        </div>
      </div>
    </div>
  );
}
