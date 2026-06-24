/** Manages up to MAX_TABS independent eval workspaces (browser-style tabs).
 *
 * Every tab renders its OWN <RunPage> and all of them stay MOUNTED — inactive
 * tabs are hidden with display:none rather than unmounted. That's deliberate:
 * a tab can keep streaming a live eval in the background while you work in
 * another, and switching tabs never loses state. A tab only unmounts (and
 * aborts its run) when you close it. */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import TabBar, { type EvalTab } from "./TabBar";
import RunPage from "../pages/RunPage";

const STORAGE_KEY = "eval-tabs";
const MAX_TABS = 10;

function newId(): string {
  return crypto.randomUUID?.() ?? `t-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

interface Persisted {
  tabs: EvalTab[];
  activeId: string;
}

function loadTabs(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Persisted>;
      const tabs = Array.isArray(j.tabs)
        ? j.tabs.filter((t): t is EvalTab => !!t && typeof t.id === "string").slice(0, MAX_TABS)
        : [];
      if (tabs.length > 0) {
        const activeId = tabs.some((t) => t.id === j.activeId) ? j.activeId! : tabs[0].id;
        return { tabs, activeId };
      }
    }
  } catch {
    /* corrupt storage → fall through to a fresh tab */
  }
  const id = newId();
  return { tabs: [{ id }], activeId: id };
}

export default function TabbedRun() {
  // Lazy-init: loadTabs() (localStorage read + JSON.parse) runs ONCE, not on every render.
  const init = useRef<Persisted | null>(null);
  if (!init.current) init.current = loadTabs();
  const [tabs, setTabs] = useState<EvalTab[]>(init.current.tabs);
  const [activeId, setActiveId] = useState<string>(init.current.activeId);
  const location = useLocation();
  const navigate = useNavigate();
  // The id of a tab to activate after a preselect adds it (set during setTabs).
  const pendingActive = useRef<string | null>(null);
  const consumedPreselect = useRef<string | null>(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
  }, [tabs, activeId]);

  // The Upload page navigates here with state.preselectProject after creating a
  // dataset. Open a fresh Prompt-mode tab on it (or, if tabs are maxed out,
  // repurpose the last one) and clear the nav state so a refresh doesn't re-fire.
  useEffect(() => {
    const pre = (location.state as { preselectProject?: string } | null)?.preselectProject;
    if (!pre || consumedPreselect.current === pre) return;
    consumedPreselect.current = pre;
    navigate(".", { replace: true, state: null });
    setTabs((ts) => {
      if (ts.length < MAX_TABS) {
        const id = newId();
        pendingActive.current = id;
        return [...ts, { id, project: pre, mode: "prompt" }];
      }
      const last = ts[ts.length - 1];
      pendingActive.current = last.id;
      return ts.map((t) => (t.id === last.id ? { ...t, project: pre, mode: "prompt" } : t));
    });
  }, [location.state, navigate]);

  // Activate the tab queued by the preselect effect, once it exists in state.
  useEffect(() => {
    if (pendingActive.current && tabs.some((t) => t.id === pendingActive.current)) {
      setActiveId(pendingActive.current);
      pendingActive.current = null;
    }
  }, [tabs]);

  function addTab() {
    if (tabs.length >= MAX_TABS) return;
    const id = newId();
    setTabs([...tabs, { id }]);
    setActiveId(id);
  }

  function closeTab(id: string) {
    if (tabs.length <= 1) return; // always keep at least one workspace
    const idx = tabs.findIndex((t) => t.id === id);
    const next = tabs.filter((t) => t.id !== id);
    setTabs(next);
    if (activeId === id) {
      const neighbor = next[Math.max(0, idx - 1)] ?? next[0];
      setActiveId(neighbor.id);
    }
  }

  function patchTab(id: string, patch: Partial<EvalTab>) {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }

  return (
    <div className="tabbed">
      <TabBar
        tabs={tabs}
        activeId={activeId}
        max={MAX_TABS}
        onSelect={setActiveId}
        onClose={closeTab}
        onAdd={addTab}
      />
      <div className="tab-panes">
        {tabs.map((t) => (
          <div key={t.id} style={{ display: t.id === activeId ? "block" : "none" }}>
            <RunPage initial={t} onChange={(patch) => patchTab(t.id, patch)} />
          </div>
        ))}
      </div>
    </div>
  );
}
