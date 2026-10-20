import { useEffect, useState } from "react";
import { NavLink, Route, Routes, Link } from "react-router-dom";
import Landing from "./pages/Landing";
import ClearVoice from "./pages/ClearVoice";
import RoadSonic from "./pages/RoadSonic";
import { call } from "./api";

export default function App() {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [status, setStatus] = useState("checking");
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { call("/api/v1/health").then(() => setStatus("online")).catch(() => setStatus("offline")); }, []);
  return (
    <div className="shell">
      <header className="top">
        <Link to="/" className="brand">◉ Signal Lab</Link>
        <nav aria-label="Projects" className="nav">
          <NavLink to="/clearvoice">ClearVoice</NavLink>
          <NavLink to="/roadsonic">RoadSonic</NavLink>
        </nav>
        <span className={"pill " + status} role="status">Backend: {status}</span>
        <button className="btn ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="Toggle theme">
          {theme === "dark" ? "☀ Light" : "☾ Dark"}
        </button>
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/clearvoice" element={<ClearVoice />} />
          <Route path="/roadsonic" element={<RoadSonic />} />
        </Routes>
      </main>
    </div>
  );
}
