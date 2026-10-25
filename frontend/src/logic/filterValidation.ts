export type FilterType = "lowpass" | "highpass" | "bandpass" | "bandstop";
export const FILTER_TYPES: FilterType[] = ["lowpass", "highpass", "bandpass", "bandstop"];
export const MIN_ORDER = 1, MAX_ORDER = 12;

/** Mirrors the backend rules (the backend remains authoritative). Returns human-readable errors; empty = valid. */
export function validateFilter(type: string, order: number, cutoffs: number[], fs: number): string[] {
  const e: string[] = [];
  if (!FILTER_TYPES.includes(type as FilterType)) { e.push("Choose a filter type."); return e; }
  if (!Number.isInteger(order) || order < MIN_ORDER || order > MAX_ORDER) e.push(`Order must be a whole number from ${MIN_ORDER} to ${MAX_ORDER}.`);
  if (!(fs > 0)) { e.push("Sample rate unknown - upload a recording first."); return e; }
  const nyq = fs / 2;
  const two = type === "bandpass" || type === "bandstop";
  if (cutoffs.length !== (two ? 2 : 1)) { e.push(two ? "Enter a lower and an upper cutoff." : "Enter one cutoff frequency."); return e; }
  if (!cutoffs.every((c) => Number.isFinite(c) && c > 0)) { e.push("Cutoff frequencies must be positive numbers."); return e; }
  if (!cutoffs.every((c) => c < nyq)) e.push(`Cutoffs must be below the Nyquist frequency (${nyq} Hz).`);
  if (two && !(cutoffs[0] < cutoffs[1])) e.push("The lower cutoff must be below the upper cutoff.");
  return e;
}

export function cutoffsFor(type: string, c1: number, c2: number): number[] {
  return type === "bandpass" || type === "bandstop" ? [c1, c2] : [c1];
}
