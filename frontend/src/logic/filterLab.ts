/** Visual Filter Lab helpers. The lab only builds the request; the backend designs the filter (the same code that processes the audio). */
import { validateFilter } from "./filterValidation.ts";
import type { Region } from "./filterRegions.ts";

export type LabType = "lowpass" | "highpass" | "bandpass" | "bandstop" | "notch";
export const LAB_TYPES: { type: LabType; name: string; blurb: string }[] = [
  { type: "lowpass", name: "Low-pass", blurb: "Lets low frequencies through, reduces high ones." },
  { type: "highpass", name: "High-pass", blurb: "Lets high frequencies through, reduces low ones." },
  { type: "bandpass", name: "Band-pass", blurb: "Keeps one band, reduces everything outside it." },
  { type: "bandstop", name: "Band-stop", blurb: "Reduces one band, keeps everything else." },
  { type: "notch", name: "Notch", blurb: "A very narrow band-stop for one unwanted tone (hum, whistle)." },
];
export interface LabState { type: LabType; f1: number; f2: number; centre: number; bandwidth: number; order: number; zeroPhase: boolean }
export const DEFAULT_LAB: LabState = { type: "lowpass", f1: 1000, f2: 3000, centre: 1000, bandwidth: 100, order: 4, zeroPhase: true };

/** Backend request for a lab state. A notch is a narrow Butterworth band-stop [centre - bw/2, centre + bw/2]; the backend has no separate notch design. */
export function toBackend(s: LabState): { filter_type: "lowpass" | "highpass" | "bandpass" | "bandstop"; cutoff_hz: number[]; method: "zero_phase" | "causal"; order: number } {
  const method = s.zeroPhase ? "zero_phase" : "causal";
  if (s.type === "notch") return { filter_type: "bandstop", cutoff_hz: [s.centre - s.bandwidth / 2, s.centre + s.bandwidth / 2], method, order: Number(s.order) };
  if (s.type === "bandpass" || s.type === "bandstop") return { filter_type: s.type, cutoff_hz: [Number(s.f1), Number(s.f2)], method, order: Number(s.order) };
  return { filter_type: s.type, cutoff_hz: [Number(s.f1)], method, order: Number(s.order) };
}

export function validateLab(s: LabState, fs: number): string[] {
  const r = toBackend(s);
  const e = validateFilter(r.filter_type, r.order, r.cutoff_hz, fs);
  if (s.type === "notch") {
    if (!(s.bandwidth > 0)) e.unshift("The notch width must be positive.");
    if (!(s.centre > 0)) e.unshift("The notch centre must be positive.");
  }
  return e;
}

/** Log-frequency slider: slider position 0..1000 <-> Hz, 20 Hz .. Nyquist*0.98. Frequency perception is logarithmic, so a linear slider would waste most of its travel. */
const FMIN = 20;
export const sliderToHz = (v: number, fs: number) => Math.round(FMIN * Math.pow((fs / 2) * 0.98 / FMIN, v / 1000));
export const hzToSlider = (hz: number, fs: number) => Math.round(1000 * Math.log(Math.max(hz, FMIN) / FMIN) / Math.log((fs / 2) * 0.98 / FMIN));

/** Plain-language summary of which frequencies a measured response keeps and which it reduces (from the response, not from the filter name). */
export function retainedSummary(regions: Region[]): { kept: string; reduced: string } {
  const fmt = (r: Region) => `${Math.round(r.f0)}–${Math.round(r.f1)} Hz`;
  const kept = regions.filter((r) => r.kind === "pass").map(fmt), red = regions.filter((r) => r.kind === "stop").map(fmt), mid = regions.filter((r) => r.kind === "transition").map(fmt);
  return { kept: kept.join(", ") || "none", reduced: red.join(", ") || (mid.length ? "only partly reduced (no band reaches -40 dB)" : "none") + (red.length && mid.length ? "" : "") };
}

/** Largest dB difference between two measured responses over their common frequency range (linear interpolation). Used to show that the
 *  theoretical preview and the response returned with the processed result agree. */
export function maxResponseDifferenceDb(a: { freqs_hz: number[]; magnitude_db: number[] }, b: { freqs_hz: number[]; magnitude_db: number[] }): number | null {
  const lo = Math.max(a.freqs_hz[0], b.freqs_hz[0]), hi = Math.min(a.freqs_hz[a.freqs_hz.length - 1], b.freqs_hz[b.freqs_hz.length - 1]);
  if (!(hi > lo)) return null;
  const at = (r: typeof a, f: number) => { let i = 1; while (i < r.freqs_hz.length - 1 && r.freqs_hz[i] < f) i++; const f0 = r.freqs_hz[i - 1], f1 = r.freqs_hz[i], t = f1 === f0 ? 0 : (f - f0) / (f1 - f0); return r.magnitude_db[i - 1] + t * (r.magnitude_db[i] - r.magnitude_db[i - 1]); };
  let worst = 0;
  for (const f of a.freqs_hz) if (f >= lo && f <= hi) worst = Math.max(worst, Math.abs(at(a, f) - at(b, f)));
  return worst;
}
