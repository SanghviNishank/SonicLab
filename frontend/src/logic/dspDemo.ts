/** Small, CPU-friendly DSP helpers for the learning experiments. Synthetic demo signals only: they are never presented as the user's recording. */
export function sine(freq: number, amp: number, fs: number, n: number, phase = 0): Float64Array {
  const x = new Float64Array(n); for (let i = 0; i < n; i++) x[i] = amp * Math.sin(2 * Math.PI * freq * i / fs + phase); return x;
}
export function add(a: Float64Array, b: Float64Array): Float64Array { const n = Math.min(a.length, b.length), o = new Float64Array(n); for (let i = 0; i < n; i++) o[i] = a[i] + b[i]; return o; }

/** In-place iterative radix-2 FFT. n must be a power of two. */
export function fftInPlace(re: Float64Array, im: Float64Array): void {
  const n = re.length; if (n & (n - 1)) throw new Error("FFT length must be a power of two");
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) { const a = i + k, b = a + len / 2, tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti; const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr; } }
  }
}
/** Single-sided amplitude spectrum with a Hann window, scaled so a full-scale-amplitude sine reads its amplitude (same convention as the backend). */
export function amplitudeSpectrum(x: Float64Array, fs: number): { freqs: number[]; amp: number[] } {
  const n = x.length, re = new Float64Array(n), im = new Float64Array(n); let wsum = 0;
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / n); re[i] = x[i] * w; wsum += w; }
  fftInPlace(re, im);
  const freqs: number[] = [], amp: number[] = [];
  for (let k = 0; k <= n / 2; k++) { freqs.push(k * fs / n); amp.push((k === 0 || k === n / 2 ? 1 : 2) * Math.hypot(re[k], im[k]) / wsum); }
  return { freqs, amp };
}
/** Frequency at which a sampled sine of frequency f appears when sampled at fs: |f - round(f/fs)·fs|. */
export function aliasFrequency(f: number, fs: number): number { return Math.abs(f - Math.round(f / fs) * fs); }
export const isAliased = (f: number, fs: number) => f > fs / 2;
