import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { getSubscription } from "../api";

const linkClass = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");

export default function Sidebar() {
  const [detected, setDetected] = useState<boolean | null>(null);

  useEffect(() => {
    getSubscription()
      .then((s) => setDetected(s.claudeCli.detected))
      .catch(() => setDetected(false));
  }, []);

  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="bolt">⚡</span> ai-eval
      </div>
      <nav className="nav">
        <NavLink to="/" end className={linkClass}>
          ▶ Run
        </NavLink>
        <NavLink to="/history" className={linkClass}>
          📊 History
        </NavLink>
        <NavLink to="/compare" className={linkClass}>
          ⚖️ Compare
        </NavLink>
        <NavLink to="/matrix" className={linkClass}>
          🆚 Models
        </NavLink>
        <NavLink to="/upload" className={linkClass}>
          ⬆ Upload
        </NavLink>
        <NavLink to="/subscription" className={linkClass}>
          🔌 Subscription
        </NavLink>
      </nav>
      <div className="sidebar-foot">
        <span className={"dot " + (detected ? "ok" : "off")} />
        {detected === null ? "checking…" : detected ? "claude connected" : "claude not found"}
      </div>
    </aside>
  );
}
