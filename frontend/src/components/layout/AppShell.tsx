import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { Menu, Moon, Sun, X } from "lucide-react";
import { call } from "../../api";
import { useSession } from "../../context/Session";

export function SoundMark({ size = 26 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="SonicSense" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
    <path d="M3 16h3M26 16h3" opacity=".5" /><path d="M8 12v8M12 7v18M16 11v10M20 4v24M24 10v12" /></svg>;
}

function NavBar() {
  const [open, setOpen] = useState(false), [theme, setTheme] = useState<"dark" | "light">(() => (localStorage.getItem("sonicsense.theme") as any) ?? "dark"), [status, setStatus] = useState("checking");
  const loc = useLocation();
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("sonicsense.theme", theme); }, [theme]);        // preference only; no audio is stored
  useEffect(() => { call("/api/v1/health").then(() => setStatus("online")).catch(() => setStatus("offline")); }, []);
  useEffect(() => setOpen(false), [loc.pathname]);
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? "active" : "");
  return (
    <header className="nav">
      <Link to="/" className="brand"><SoundMark /> SonicSense</Link>
      <button className="btn ghost nav-toggle" aria-expanded={open} aria-controls="nav-links" aria-label="Menu" onClick={() => setOpen(!open)}>{open ? <X size={18} /> : <Menu size={18} />}</button>
      <nav id="nav-links" className={"nav-links" + (open ? " open" : "")} aria-label="Main">
        <NavLink to="/" end className={cls}>Overview</NavLink><NavLink to="/clearvoice" className={cls}>ClearVoice</NavLink><NavLink to="/roadsonic" className={cls}>RoadSonic</NavLink>
        <NavLink to="/how-it-works" className={cls}>How It Works</NavLink><NavLink to="/docs" className={cls}>Documentation</NavLink>
        <span className={"status-dot " + status} role="status" title="Backend connection"><i />API {status}</span>
        <button className="btn ghost" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>{theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}</button>
        <Link to="/clearvoice/upload" className="btn">Launch Workspace</Link>
      </nav>
    </header>
  );
}

export default function AppShell() {
  const loc = useLocation(), reduce = useReducedMotion(), { notice, clearNotice } = useSession();
  const module = loc.pathname.startsWith("/clearvoice") ? "clearvoice" : loc.pathname.startsWith("/roadsonic") ? "roadsonic" : undefined;
  useEffect(() => { window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <div data-module={module}>
      <a className="skip" href="#main">Skip to content</a>
      <NavBar />
      {notice && <div className="page" style={{ paddingBottom: 0 }}><div className="banner caution" role="status"><div className="row"><span>{notice}</span><button className="btn ghost" onClick={clearNotice}>Dismiss</button></div></div></div>}
      <motion.main id="main" key={loc.pathname} initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: reduce ? 0 : 0.18, ease: "easeOut" }}><Outlet /></motion.main>
    </div>
  );
}
