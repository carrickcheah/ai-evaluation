/** Manages up to MAX_TABS independent eval workspaces (browser-style tabs).
 *
 * Every tab renders its OWN <RunPage> and all of them stay MOUNTED — inactive
 * tabs are hidden with display:none rather than unmounted. That's deliberate:
 * a tab can keep streaming a live eval in the background while you work in
 * another, and switching tabs never loses state. A tab only unmounts (and
 * aborts its run) when you close it. */
import { useEffect, useRef, useState } from "react";
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

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tabs, activeId }));
  }, [tabs, activeId]);

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

  function setTabProject(id: string, project: string) {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, project } : t)));
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
            <RunPage initialProject={t.project} onProjectChange={(p) => setTabProject(t.id, p)} />
          </div>
        ))}
      </div>
    </div>
  );
}
