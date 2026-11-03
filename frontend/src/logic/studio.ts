/** Pure helpers for the Before vs After Studio (no DOM, unit-tested). */
export const SYNC_TOLERANCE_S = 0.15;

export const needsResync = (a: number, b: number, tol = SYNC_TOLERANCE_S) => Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) > tol;

/** The part of the timeline both recordings have. If they differ in length the extra tail of the longer one is not comparable. */
export function comparableDuration(a: number, b: number): number {
  const v = [a, b].filter((x) => Number.isFinite(x) && x > 0);
  return v.length ? Math.min(...v) : 0;
}

export interface Section { start: number; end: number }
/** Validates a user-selected listening section against the comparable duration. */
export function normalizeSection(start: number, end: number, duration: number): { section: Section | null; error: string } {
  if (![start, end, duration].every(Number.isFinite)) return { section: null, error: "Enter start and end times in seconds." };
  if (start < 0 || end > duration + 1e-9) return { section: null, error: `The section must lie within 0 and ${duration.toFixed(2)} s.` };
  if (end - start < 0.2) return { section: null, error: "The section must be at least 0.2 s long." };
  return { section: { start, end }, error: "" };
}

/** What the player should do at time t when a section is active. */
export function sectionAction(t: number, s: Section | null, loop: boolean): "none" | "loop" | "stop" {
  if (!s || t < s.end) return "none";
  return loop ? "loop" : "stop";
}

export const fmtDb = (v: number | null | undefined, nd = 1) => (v == null || !Number.isFinite(v) ? "n/a" : `${v.toFixed(nd)} dB`);
export const fmtLin = (v: number | null | undefined, nd = 4) => (v == null || !Number.isFinite(v) ? "n/a" : v.toFixed(nd));

export interface LevelRow { label: string; original: string; processed: string; change: string }
/** Rows of the measured-levels table, built only from the backend /levels response. Change is processed minus original in dB. */
export function levelRows(lv: any): LevelRow[] {
  const rows: LevelRow[] = [];
  (lv?.original?.channels ?? []).forEach((o: any, i: number) => {
    const p = lv.processed.channels[i];
    const d = (a: number | null, b: number | null) => (a == null || b == null ? "n/a" : `${(b - a >= 0 ? "+" : "")}${(b - a).toFixed(1)} dB`);
    rows.push({ label: `Ch ${i} RMS`, original: `${fmtLin(o.rms)} (${fmtDb(o.rms_dbfs)} FS)`, processed: `${fmtLin(p.rms)} (${fmtDb(p.rms_dbfs)} FS)`, change: d(o.rms_dbfs, p.rms_dbfs) });
    rows.push({ label: `Ch ${i} peak`, original: `${fmtLin(o.peak)} (${fmtDb(o.peak_dbfs)} FS)`, processed: `${fmtLin(p.peak)} (${fmtDb(p.peak_dbfs)} FS)`, change: d(o.peak_dbfs, p.peak_dbfs) });
    rows.push({ label: `Ch ${i} clipped samples`, original: String(o.clipped_samples), processed: String(p.clipped_samples), change: String(p.clipped_samples - o.clipped_samples) });
  });
  return rows;
}

export function processedUrl(base: string, jobId: string, matched: boolean) {
  return `${base}/api/v1/clearvoice/${jobId}/download${matched ? "?match_loudness=true" : ""}`;
}
