"""Frame-level features for the RoadSonic rule-based detector.

Frames: L = round(frame_ms*fs/1000) samples, hop H, Hann window, zero-padded FFT.
Per frame (all computed on the analysis band [band_lo, band_hi] where noted):
  rms_db        : 20log10 RMS of the windowed-free time frame (dBFS)
  centroid_hz   : sum(f P)/sum(P)   (band)
  bandwidth_hz  : sqrt(sum((f-centroid)^2 P)/sum(P))   (band)
  dom_freq_hz   : parabolic-interpolated spectral peak in band
  flatness      : spectral flatness in band = geometric mean / arithmetic mean of power (1 = noise-like, ->0 = tonal)
  peak_prominence_db : dominant-peak power over the median band power, in dB (how far the peak stands out)
  tonal_ratio   : energy in dominant peak +/- peak_halfwidth bins / energy in a wider context band
                  [100 Hz, min(1.5*band_hi, 0.45*fs)] (0..1). The wider denominator stops steep
                  low-frequency road-noise slopes leaking into the band from looking like a tone.
  zcr           : zero-crossing rate (crossings per sample)
A peak sitting on the first/last band bin is a spectral slope (e.g. low-pass road noise leaking
into the band), not a tone, so tonal_ratio is set to 0 there.
tonal_ratio is scale invariant, so detection does not depend on recording level.
"""
from __future__ import annotations

import numpy as np
from .fft_analysis import make_window

FEATURE_NAMES = ["time_s", "rms_db", "centroid_hz", "bandwidth_hz", "flatness", "dom_freq_hz", "peak_prominence_db", "tonal_ratio", "zcr"]


def extract_features(x: np.ndarray, fs: float, frame_ms: float = 64.0, hop_ms: float = 16.0,
                     band_lo: float = 450.0, band_hi: float = 2000.0, peak_halfwidth: int = 2) -> dict:
    x = np.asarray(x, dtype=np.float64)
    if x.ndim != 1:
        raise ValueError("expected a 1-D (mono) analysis signal")
    n_samples = int(x.size)
    if not (0 < band_lo < band_hi < fs / 2):
        raise ValueError("band must satisfy 0 < band_lo < band_hi < Nyquist")
    L = int(round(frame_ms * fs / 1000.0))
    H = max(1, int(round(hop_ms * fs / 1000.0)))
    if L < 16:
        raise ValueError("frame too short")
    if x.size < L:
        x = np.concatenate([x, np.zeros(L - x.size)])
    n_frames = 1 + (x.size - L) // H
    n_fft = 1 << int(np.ceil(np.log2(L)))
    freqs = np.fft.rfftfreq(n_fft, 1.0 / fs)
    band = np.where((freqs >= band_lo) & (freqs <= band_hi))[0]
    if band.size < 2 * peak_halfwidth + 3:
        raise ValueError("analysis band contains too few FFT bins")
    ctx = np.where((freqs >= 100.0) & (freqs <= min(1.5 * band_hi, 0.45 * fs)))[0]  # context band for tonality
    w = make_window("hann", L)
    df = freqs[1]
    out = {k: np.zeros(n_frames) for k in FEATURE_NAMES}
    chunk = max(1, 2_000_000 // n_fft)
    for s in range(0, n_frames, chunk):
        e = min(n_frames, s + chunk)
        idx = (np.arange(s, e) * H)[:, None] + np.arange(L)[None, :]
        fr = x[idx]
        P = np.abs(np.fft.rfft(fr * w, n=n_fft, axis=1)) ** 2
        Pb = P[:, band]
        tot = Pb.sum(axis=1)
        safe = np.where(tot > 0, tot, 1.0)
        fb = freqs[band]
        cen = (Pb * fb).sum(axis=1) / safe
        bw = np.sqrt((Pb * (fb[None, :] - cen[:, None]) ** 2).sum(axis=1) / safe)
        k = Pb.argmax(axis=1)
        # parabolic interpolation on log power
        kk = np.clip(k, 1, Pb.shape[1] - 2)
        r = np.arange(e - s)
        la = np.log(np.maximum(Pb[r, kk - 1], 1e-300)) / 2
        lb = np.log(np.maximum(Pb[r, kk], 1e-300)) / 2
        lc = np.log(np.maximum(Pb[r, kk + 1], 1e-300)) / 2
        den = la - 2 * lb + lc
        delta = np.where(den != 0, 0.5 * (la - lc) / np.where(den != 0, den, 1), 0.0)
        delta = np.clip(delta, -1, 1)
        dom = fb[kk] + delta * df
        cs = np.cumsum(np.pad(Pb, ((0, 0), (1, 0))), axis=1)
        lo = np.clip(kk - peak_halfwidth, 0, Pb.shape[1])
        hi = np.clip(kk + peak_halfwidth + 1, 0, Pb.shape[1])
        pk = cs[r, hi] - cs[r, lo]
        ctx_tot = P[:, ctx].sum(axis=1)
        tonal = np.where(ctx_tot > 0, pk / np.where(ctx_tot > 0, ctx_tot, 1.0), 0.0)
        eps = 1e-30
        flat = np.exp(np.mean(np.log(Pb + eps), axis=1)) / (np.mean(Pb, axis=1) + eps)
        prom = 10 * np.log10((Pb[r, kk] + eps) / (np.median(Pb, axis=1) + eps))
        tonal = np.where((k == 0) | (k == Pb.shape[1] - 1), 0.0, tonal)  # peak on band edge = spectral slope, not a tone
        rms = np.sqrt(np.mean(fr ** 2, axis=1))
        zc = np.mean(np.abs(np.diff(np.signbit(fr).astype(np.int8), axis=1)), axis=1)
        sl = slice(s, e)
        out["time_s"][sl] = (np.arange(s, e) * H + L / 2) / fs
        out["rms_db"][sl] = 20 * np.log10(np.maximum(rms, 1e-10))
        out["centroid_hz"][sl] = np.where(tot > 0, cen, 0.0)
        out["bandwidth_hz"][sl] = bw
        out["dom_freq_hz"][sl] = np.where(tot > 0, dom, 0.0)
        out["flatness"][sl] = np.where(tot > 0, flat, 1.0)
        out["peak_prominence_db"][sl] = np.where(tot > 0, prom, 0.0)
        out["tonal_ratio"][sl] = tonal
        out["zcr"][sl] = zc
    out["meta"] = {"frame_length": L, "hop_length": H, "n_fft": n_fft, "window": "hann",
                   "band_hz": [band_lo, band_hi], "peak_halfwidth_bins": peak_halfwidth,
                   "frame_ms": frame_ms, "hop_ms": hop_ms, "sample_rate": fs, "n_samples": n_samples,
                   "duration_s": n_samples / fs}
    return out
