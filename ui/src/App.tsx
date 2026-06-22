import { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";
import Sidebar from "./components/Sidebar";
import TabbedRun from "./components/TabbedRun";
import HistoryPage, { HistoryDetail } from "./pages/HistoryPage";
import SubscriptionPage from "./pages/SubscriptionPage";

type Theme = "dark" | "light";

export default function App() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "dark",
  );

  useEffect(() => {
    // Apply on <html> (not <body>): redefining CSS vars on body itself doesn't
    // repaint the propagated body background in Chrome; on :root it inherits cleanly.
    document.documentElement.classList.toggle("light", theme === "light");
    localStorage.setItem("theme", theme);
  }, [theme]);

  return (
    <div className="layout">
      <Sidebar />
      <div className="content">
        <div className="topbar">
          <button
            className="theme-toggle"
            onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
            title="Toggle light / dark"
          >
            {theme === "dark" ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>
        <main className="main">
          <Routes>
            <Route path="/" element={<TabbedRun />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/history/:id" element={<HistoryDetail />} />
            <Route path="/subscription" element={<SubscriptionPage />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
