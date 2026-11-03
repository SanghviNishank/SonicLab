import { useSyncExternalStore } from "react";

export type LearnMode = "beginner" | "technical";
const KEY = "sonicsense.learnMode";
let mode: LearnMode = "beginner";
try { const v = localStorage.getItem(KEY); if (v === "technical" || v === "beginner") mode = v; } catch { /* storage unavailable: default */ }
const subs = new Set<() => void>();
export function setLearnMode(m: LearnMode) { mode = m; try { localStorage.setItem(KEY, m); } catch { /* ignore */ } subs.forEach((f) => f()); }
/** Beginner / Technical explanation mode shared by the Filter Lab, the DSP Learning Assistant and Presentation Mode. */
export function useLearningMode(): [LearnMode, (m: LearnMode) => void] {
  const m = useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => mode, () => "beginner" as LearnMode);
  return [m, setLearnMode];
}
