import { useEffect, useState } from "react";
import { getConnections, saveConnection, deleteConnection, type Connection } from "../api";

/** Manage named bot endpoints (Local / Live production / …). Each holds the URL,
 * headers (secrets as ${ENV}), request body template, and answerPath. Persisted
 * server-side in connections.json, so they're remembered until removed. */
const blank = (): Connection => ({
  id: "",
  name: "",
  url: "http://localhost:8002/api/chat/sync",
  method: "POST",
  headers: {},
  body: { message: "{{input}}", phone_number: "{{uid}}", source: "api", account_id: 14, session_id: "{{uid}}" },
  answerPath: "output",
});

export default function ConnectionsPage() {
  const [conns, setConns] = useState<Connection[]>([]);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [headersText, setHeadersText] = useState("{}");
  const [bodyText, setBodyText] = useState("{}");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  function load() {
    getConnections().then(setConns).catch((e) => setError(String(e)));
  }
  useEffect(load, []);

  function edit(c: Connection) {
    setError("");
    setNotice("");
    setEditing({ ...c });
    setHeadersText(JSON.stringify(c.headers ?? {}, null, 2));
    setBodyText(JSON.stringify(c.body ?? {}, null, 2));
  }

  async function save() {
    if (!editing) return;
    let headers: Record<string, string>;
    let body: unknown;
    try {
      headers = JSON.parse(headersText || "{}");
    } catch {
      setError("Headers is not valid JSON");
      return;
    }
    try {
      body = JSON.parse(bodyText || "{}");
    } catch {
      setError("Body is not valid JSON");
      return;
    }
    setError("");
    try {
      await saveConnection({ ...editing, headers, body });
      setNotice(`Saved "${editing.name}"`);
      setEditing(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove endpoint "${name}"?`)) return;
    try {
      await deleteConnection(id);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div>
      <h1 className="page-title">🔗 Bot Endpoints</h1>
      <p className="muted" style={{ maxWidth: 720 }}>
        Named bot endpoints you can pick between on the Run page (e.g. <b>Local</b> vs{" "}
        <b>Live production</b>). Saved on the server and remembered until you remove them. Keep
        secrets as <code>{"${BOT_KEY}"}</code> — they stay on the server, resolved only at run time.
      </p>

      {error && <p className="err">{error}</p>}
      {notice && <p className="muted">{notice}</p>}

      <div className="card">
        <table className="conn-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>URL</th>
              <th style={{ width: 140 }}></th>
            </tr>
          </thead>
          <tbody>
            {conns.map((c) => (
              <tr key={c.id}>
                <td><b>{c.name}</b><div className="muted" style={{ fontSize: 12 }}>{c.id}</div></td>
                <td className="mono">{c.url}</td>
                <td>
                  <button className="secondary" onClick={() => edit(c)}>Edit</button>{" "}
                  <button className="secondary" onClick={() => remove(c.id, c.name)}>Delete</button>
                </td>
              </tr>
            ))}
            {conns.length === 0 && (
              <tr><td colSpan={3} className="muted">No endpoints yet.</td></tr>
            )}
          </tbody>
        </table>
        <button onClick={() => edit(blank())}>+ New endpoint</button>
      </div>

      {editing && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>{editing.id ? "Edit" : "New"} endpoint</h3>
          <div className="row">
            <label>Name</label>
            <input
              type="text"
              value={editing.name}
              placeholder="Live bot — production"
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              style={{ minWidth: 320 }}
            />
          </div>
          <div className="row">
            <label>URL</label>
            <input
              type="text"
              value={editing.url}
              onChange={(e) => setEditing({ ...editing, url: e.target.value })}
              style={{ minWidth: 460 }}
            />
          </div>
          <div className="row">
            <label>answerPath</label>
            <input
              type="text"
              value={editing.answerPath}
              onChange={(e) => setEditing({ ...editing, answerPath: e.target.value })}
              style={{ minWidth: 160 }}
            />
            <span className="muted" style={{ marginLeft: 8 }}>dot-path to the reply in the JSON response (e.g. output)</span>
          </div>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label style={{ paddingTop: 8 }}>Headers (JSON)</label>
            <textarea className="sysprompt" rows={3} value={headersText} onChange={(e) => setHeadersText(e.target.value)} />
          </div>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label style={{ paddingTop: 8 }}>Body (JSON)</label>
            <textarea className="sysprompt" rows={7} value={bodyText} onChange={(e) => setBodyText(e.target.value)} />
          </div>
          <div className="row">
            <button onClick={save}>Save</button>{" "}
            <button className="secondary" onClick={() => setEditing(null)} style={{ marginLeft: 8 }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
