/** Classify a measured magnitude response into passband / transition / stopband from the numbers themselves (no assumed ideal filter).
 *  passband: |H| >= passDb (default -3 dB; use -6 dB for forward-backward filtering, which squares |H|)
 *  stopband: |H| <= stopDb (default -40 dB). Everything else is transition. */
export type RegionKind = "pass" | "transition" | "stop";
export interface Region { kind: RegionKind; f0: number; f1: number }

export function classifyResponse(freqs: number[], magDb: number[], passDb = -3, stopDb = -40): Region[] {
  const n = Math.min(freqs.length, magDb.length);
  if (n < 2) return [];
  const kind = (m: number): RegionKind => (m >= passDb ? "pass" : m <= stopDb ? "stop" : "transition");
  const out: Region[] = [];
  let start = 0, cur = kind(magDb[0]);
  for (let i = 1; i < n; i++) {
    const k = kind(magDb[i]);
    if (k !== cur) { out.push({ kind: cur, f0: freqs[start], f1: freqs[i] }); start = i; cur = k; }
  }
  out.push({ kind: cur, f0: freqs[start], f1: freqs[n - 1] });
  return out;
}

export function describeRegions(regions: Region[]): string {
  const name = { pass: "passband", transition: "transition band", stop: "stopband" } as const;
  return regions.map((r) => `${name[r.kind]} ${Math.round(r.f0)}–${Math.round(r.f1)} Hz`).join("; ");
}
