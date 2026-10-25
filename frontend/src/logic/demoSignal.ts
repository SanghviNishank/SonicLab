/** Illustrative synthetic signals for the landing page. Generated locally; clearly labelled as demo data in the UI. */
export const DEMO_FS = 8000;

export function demoChirp(seconds = 2, fs = DEMO_FS): { t: number[]; y: number[] } {
  const n = Math.round(seconds * fs), t: number[] = [], y: number[] = [];
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const ti = i / fs, f = 900 + 500 * Math.sin(2 * Math.PI * 0.5 * ti);          // 400-1400 Hz sweep, 0.5 sweeps/s: siren-like
    phase += (2 * Math.PI * f) / fs; t.push(ti); y.push(0.7 * Math.sin(phase) + 0.12 * Math.sin(2 * Math.PI * 60 * ti));
  }
  return { t, y };
}

/** Single-sided Hann-windowed amplitude spectrum by direct DFT (small N only). amp = 2|X|/sum(w). */
export function demoSpectrum(x: number[], fs = DEMO_FS, n = 1024): { f: number[]; a: number[] } {
  const seg = x.slice(0, n), w = seg.map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))), sw = w.reduce((a, b) => a + b, 0);
  const f: number[] = [], a: number[] = [];
  for (let k = 0; k <= n / 2; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < n; i++) { const v = seg[i] * w[i], ang = (-2 * Math.PI * k * i) / n; re += v * Math.cos(ang); im += v * Math.sin(ang); }
    f.push((k * fs) / n); a.push(((k === 0 || k === n / 2 ? 1 : 2) * Math.hypot(re, im)) / sw);
  }
  return { f, a };
}

/** dB magnitude of an order-N Butterworth low-pass: -10 log10(1 + (f/fc)^(2N)). */
export function butterworthLowpassDb(f: number[], fc: number, order: number): number[] {
  return f.map((v) => -10 * Math.log10(1 + Math.pow(v / fc, 2 * order)));
}

export function demoSpectrogram(x: number[], fs = DEMO_FS, frame = 256, hop = 128): { t: number[]; f: number[]; z: number[][] } {
  const w = Array.from({ length: frame }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (frame - 1))), sw = w.reduce((a, b) => a + b, 0);
  const nFrames = 1 + Math.floor((x.length - frame) / hop), nBins = frame / 2 + 1;
  const t: number[] = [], f = Array.from({ length: nBins }, (_, k) => (k * fs) / frame), z: number[][] = Array.from({ length: nBins }, () => new Array(nFrames).fill(0));
  for (let m = 0; m < nFrames; m++) {
    t.push((m * hop + frame / 2) / fs);
    for (let k = 0; k < nBins; k++) {
      let re = 0, im = 0;
      for (let i = 0; i < frame; i++) { const v = x[m * hop + i] * w[i], ang = (-2 * Math.PI * k * i) / frame; re += v * Math.cos(ang); im += v * Math.sin(ang); }
      z[k][m] = 20 * Math.log10(Math.max(((k === 0 || k === frame / 2 ? 1 : 2) * Math.hypot(re, im)) / sw, 1e-6));
    }
  }
  return { t, f, z };
}

export const DEMO_EVENTS = [{ start: 0.4, end: 1.7, label: "Illustrative candidate event" }];
