/** Browser-style tab strip. Each tab is an independent eval workspace. */
export interface EvalTab {
  id: string;
  project?: string;
  mode?: "bot" | "prompt";
  systemPrompt?: string;
  answerModel?: string;
  connectionId?: string;
}

export default function TabBar({
  tabs,
  activeId,
  max,
  onSelect,
  onClose,
  onAdd,
}: {
  tabs: EvalTab[];
  activeId: string;
  max: number;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
}) {
  const full = tabs.length >= max;
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t, i) => (
        <div
          key={t.id}
          className={"tab" + (t.id === activeId ? " active" : "")}
          role="tab"
          aria-selected={t.id === activeId}
          title={t.project ?? `Eval ${i + 1}`}
          onClick={() => onSelect(t.id)}
        >
          <span className="tab-label">{t.project ?? `Eval ${i + 1}`}</span>
          {tabs.length > 1 && (
            <button
              className="tab-close"
              title="Close tab"
              aria-label="Close tab"
              onClick={(e) => {
                e.stopPropagation();
                onClose(t.id);
              }}
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        className="tab-add"
        title={full ? `Max ${max} tabs` : "New eval tab"}
        aria-label="New eval tab"
        disabled={full}
        onClick={onAdd}
      >
        ＋
      </button>
    </div>
  );
}
