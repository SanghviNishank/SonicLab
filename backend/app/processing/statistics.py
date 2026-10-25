"""Time-domain statistics.

Conventions (used everywhere in the API/UI):
  * samples are float64 in the nominal range [-1, 1]
  * variance is the POPULATION variance (ddof = 0): var = mean((x - mean)^2)
  * RMS = sqrt(mean(x^2))   (note RMS^2 = var + mean^2)
  * time axis: t[n] = n / fs
"""
from __future__ import annotations

import numpy as np


def as_2d(x: np.ndarray) -> np.ndarray:
    """Return samples as (channels, samples) without copying when possible."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        return x[np.newaxis, :]
    if x.ndim != 2:
        raise ValueError("audio must be 1-D (samples) or 2-D (channels, samples)")
    return x


def time_axis(n_samples: int, fs: float) -> np.ndarray:
    if fs <= 0:
        raise ValueError("sample rate must be positive")
    return np.arange(n_samples, dtype=np.float64) / fs


def channel_statistics(x: np.ndarray, fs: float, clip_level: float = 0.999,
                       silence_dbfs: float = -60.0, silence_win_s: float = 0.05) -> dict:
    """Statistics for a single channel (1-D array)."""
    x = np.asarray(x, dtype=np.float64)
    n = x.size
    if n == 0:
        raise ValueError("empty signal")
    mean = float(np.mean(x))
    rms = float(np.sqrt(np.mean(x * x)))
    var = float(np.var(x))  # ddof=0 (population)
    mn, mx = float(x.min()), float(x.max())
    peak = float(np.max(np.abs(x)))
    crest = float(peak / rms) if rms > 0 else None  # undefined for silence
    clipped = int(np.count_nonzero(np.abs(x) >= clip_level))

    w = max(1, int(round(silence_win_s * fs)))
    nwin = n // w
    silent_fraction = 0.0
    if nwin >= 1:
        seg = x[: nwin * w].reshape(nwin, w)
        seg_rms = np.sqrt(np.mean(seg * seg, axis=1))
        silent_fraction = float(np.mean(seg_rms < 10 ** (silence_dbfs / 20)))
    return {
        "min": mn, "max": mx, "mean": mean, "rms": rms,
        "variance": var, "peak_abs": peak, "peak_to_peak": mx - mn,
        "crest_factor": crest, "clipped_samples": clipped,
        "silent_window_fraction": silent_fraction,
    }


def audio_statistics(x: np.ndarray, fs: float) -> dict:
    x2 = as_2d(x)
    chans = [channel_statistics(c, fs) for c in x2]
    warnings = []
    for i, c in enumerate(chans):
        if c["clipped_samples"] > 0:
            warnings.append(f"Channel {i}: {c['clipped_samples']} samples at/near full scale (possible clipping).")
        if c["silent_window_fraction"] > 0.2:
            warnings.append(f"Channel {i}: {c['silent_window_fraction']*100:.0f}% of 50 ms windows are near-silent (< -60 dBFS).")
        if c["rms"] == 0:
            warnings.append(f"Channel {i}: signal is digital silence.")
    return {
        "sample_rate": float(fs), "channels": int(x2.shape[0]),
        "samples_per_channel": int(x2.shape[1]),
        "duration_s": float(x2.shape[1] / fs),
        "variance_definition": "population (ddof=0)",
        "per_channel": chans, "warnings": warnings,
    }


def downsample_minmax(x: np.ndarray, max_points: int = 4000):
    """DISPLAY-ONLY decimation preserving extrema. Returns (indices, values).

    Never feed this output to signal processing.
    """
    x = np.asarray(x, dtype=np.float64)
    n = x.size
    if n <= max_points:
        return np.arange(n), x.copy()
    buckets = max(1, max_points // 2)
    edges = np.linspace(0, n, buckets + 1, dtype=np.int64)
    idx, val = [], []
    for a, b in zip(edges[:-1], edges[1:]):
        seg = x[a:b]
        if seg.size == 0:
            continue
        i0, i1 = int(np.argmin(seg)) + int(a), int(np.argmax(seg)) + int(a)
        for i in sorted({i0, i1}):
            idx.append(i)
            val.append(x[i])
    return np.asarray(idx), np.asarray(val)


def range_statistics(x: np.ndarray, fs: float, t0: float, t1: float, channel: int = 0) -> dict:
    """Exact statistics of the FULL-RESOLUTION samples in [t0, t1] seconds (never the display-decimated data).
    Sample indices: i0 = round(t0*fs), i1 = round(t1*fs); the returned start/end are those sample boundaries / fs."""
    x2 = as_2d(x)
    if not 0 <= channel < x2.shape[0]:
        raise ValueError("channel out of range")
    dur = x2.shape[1] / fs
    if not (np.isfinite(t0) and np.isfinite(t1)) or t0 < 0 or t1 > dur + 1e-9 or t1 <= t0:
        raise ValueError(f"range must satisfy 0 <= start < end <= {dur:.6f} s")
    i0, i1 = int(round(t0 * fs)), min(int(round(t1 * fs)), x2.shape[1])
    if i1 - i0 < 2:
        raise ValueError("selected range contains fewer than 2 samples")
    return {"start_s": i0 / fs, "end_s": i1 / fs, "start_sample": i0, "end_sample": i1, "n_samples": i1 - i0, "channel": channel,
            "statistics": channel_statistics(x2[channel, i0:i1], fs)}
