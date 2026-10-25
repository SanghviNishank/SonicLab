import { Component, lazy, Suspense, useMemo, type ReactNode } from "react";
import { useReducedMotion } from "framer-motion";
import type { SculptureMode } from "./SoundSculpture";

const Sculpture = lazy(() => import("./SoundSculpture"));      // three.js is only downloaded on the landing page

function webglOk(): boolean { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; } }

export function HeroFallback() {
  return <svg className="hero-canvas" viewBox="0 0 800 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true" fill="none" strokeWidth="1.4">
    {Array.from({ length: 14 }, (_, r) => <path key={r} stroke={r % 2 ? "var(--violet)" : "var(--cyan)"} opacity={0.18 + 0.04 * (r % 5)} d={`M0 ${200 + (r - 7) * 9} ` + Array.from({ length: 41 }, (_, i) => { const x = i * 20, env = Math.exp(-Math.pow((x - 400) / 220, 2)); return `L${x} ${200 + (r - 7) * 9 - env * 70 * Math.sin(i * 0.5 + r * 0.35)}`; }).join(" ")} />)}</svg>;
}

class Boundary extends Component<{ children: ReactNode; fallback: ReactNode }, { bad: boolean }> {
  state = { bad: false }; static getDerivedStateFromError() { return { bad: true }; } render() { return this.state.bad ? this.props.fallback : this.props.children; }
}

export default function HeroVisual({ mode }: { mode: SculptureMode }) {
  const reduced = !!useReducedMotion(), ok = useMemo(() => webglOk() && window.innerWidth >= 640, []);       // small screens get the light SVG
  if (!ok) return <HeroFallback />;
  return <Boundary fallback={<HeroFallback />}><Suspense fallback={<HeroFallback />}><Sculpture mode={mode} reduced={reduced} /></Suspense></Boundary>;
}
