import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createDataset } from "../api";

/** Create a brand-new dataset from an uploaded CSV / promptfoo file. On success
 * we jump to the Run page with the new dataset preselected in a fresh tab. */
export default function UploadPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const canCreate = name.trim() !== "" && !!file && !busy;

  async function create() {
    if (!file || !name.trim()) return;
    setError("");
    setBusy(true);
    try {
      const n = file.name.toLowerCase();
      const format = n.endsWith(".yaml") || n.endsWith(".yml") ? "promptfoo" : "csv";
      const r = await createDataset(name.trim(), await file.text(), format);
      // Hand the new dataset name to TabbedRun, which opens a Prompt-mode tab on it.
      navigate("/", { state: { preselectProject: r.name } });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div>
      <h1 className="page-title">⬆ Upload dataset</h1>
      <p className="muted" style={{ maxWidth: 700 }}>
        Create a new dataset from a CSV (columns: input, expected[, tags, description]) or a
        promptfoo eval .yaml. It appears in the Dataset dropdown, ready to test in Prompt mode and
        Models comparison. Graded by Claude sonnet with a general accuracy rubric you can tweak
        later in the dataset's config.
      </p>

      <div className="card">
        <div className="row">
          <label>Name</label>
          <input
            type="text"
            value={name}
            placeholder="e.g. pricing-questions"
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            style={{ minWidth: 280 }}
          />
        </div>

        <div className="row">
          <label>File</label>
          <button className="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {file ? "⬆ Change file" : "⬆ Choose CSV / promptfoo"}
          </button>
          {file && <span className="muted" style={{ marginLeft: 8 }}>{file.name}</span>}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.yaml,.yml,text/csv,text/yaml"
            style={{ display: "none" }}
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              e.target.value = ""; // allow re-picking the same file
            }}
          />
        </div>

        <div className="row">
          <button onClick={create} disabled={!canCreate}>
            {busy ? "Creating…" : "Create dataset"}
          </button>
          {!file && <span className="muted" style={{ marginLeft: 10 }}>Choose a file to upload</span>}
        </div>

        {error && <p className="err">{error}</p>}
      </div>
    </div>
  );
}
