"""Short-Time Fourier Transform.

X_m[k] = sum_{n=0}^{L-1} x[n + mH] w[n] exp(-j 2 pi k n / L)

* frame m covers samples [mH, mH+L); time stamp = frame centre (mH + L/2)/fs
* frequency axis f_k = k fs / L, k = 0..L/2
* dB reference: single-sided amplitude, full-scale sinusoid (A=1.0) = 0 dB
* signals shorter than one frame are zero-padded to one frame (flagged in output)
"""
from __future__ import annotations

import numpy as np
from .fft_analysis import make_window

MAX_CELLS = 40_000_000


def stft_db(x: np.ndarray, fs: float, frame_length: int = 1024, hop_length: int | None = None,
            window: str = "hann", floor_db: float = -120.0, dtype=np.float32) -> dict:
    x = np.asarray(x, dtype=np.float64)
    if x.ndim != 1:
        raise ValueError("x must be a 1-D channel")
    L = int(frame_length)
    if L < 8 or L > 65536:
        raise ValueError("frame_length must be within [8, 65536]")
    H = int(hop_length) if hop_length else max(1, L // 4)
    if H < 1 or H > L:
        raise ValueError("hop_length must be within [1, frame_length]")
    n = x.size
    padded = False
    if n < L:
        x = np.concatenate([x, np.zeros(L - n)])
        padded, n = True, L
    n_frames = 1 + (n - L) // H
    n_bins = L // 2 + 1
    if n_frames * n_bins > MAX_CELLS:
        raise ValueError("spectrogram too large; increase hop_length or reduce frame_length")
    w = make_window(window, L)
    sw = float(np.sum(w))
    floor = 10 ** (floor_db / 20)
    out = np.empty((n_bins, n_frames), dtype=dtype)
    chunk = max(1, 4_000_000 // L)
    for s in range(0, n_frames, chunk):
        e = min(n_frames, s + chunk)
        idx = (np.arange(s, e) * H)[:, None] + np.arange(L)[None, :]
        amp = np.abs(np.fft.rfft(x[idx] * w, axis=1)) / sw
        if L % 2 == 0:
            amp[:, 1:-1] *= 2.0
        else:
            amp[:, 1:] *= 2.0
        out[:, s:e] = (20 * np.log10(np.maximum(amp, floor))).T
    return {
        "times_s": (np.arange(n_frames) * H + L / 2) / fs,
        "freqs_hz": np.arange(n_bins) * fs / L,
        "magnitude_db": out, "frame_length": L, "hop_length": H, "window": window,
        "reference": "dB re full-scale single-sided amplitude (1.0 = 0 dB)",
        "floor_db": floor_db, "zero_padded_short_signal": padded,
    }
