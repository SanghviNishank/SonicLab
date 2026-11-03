import { useSyncExternalStore } from "react";
import { clampStep, type ModuleKey } from "./steps.ts";

export interface PState { open: boolean; module: ModuleKey | null; index: number }
let st: PState = { open: false, module: null, index: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<PState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
export const presentation = {
  /** module null = show the chooser first. */
  start: (module: ModuleKey | null = null) => set({ open: true, module, index: 0 }),
  exit: () => set({ open: false }),
  restart: () => set({ index: 0 }),
  go: (i: number, total: number) => set({ index: clampStep(i, total) }),
  choose: (module: ModuleKey) => set({ module, index: 0 }),
  get: () => st,
};
export function usePresentation(): PState { return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => st, () => st); }
