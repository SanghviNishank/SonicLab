"""Single-sided amplitude spectrum with documented calibration.

DFT:  X[k] = sum_{n=0}^{N-1} x[n] exp(-j 2 pi k n / N)
Bin spacing: df = fs / N_fft.   Nyquist: fs / 2.

Calibration: X = rfft(x*w, n_fft); coherent gain CG = sum(w)/N.
A real sinusoid of amplitude A on a bin centre gives |X[k]| = A*sum(w)/2, so
    amplitude[k] = 2|X[k]| / sum(w)   for 0 < k < n_fft/2
    amplitude[0] = |X[0]| / sum(w)    (DC, not doubled)
    amplitude[n_fft/2] = |X|/sum(w)   (Nyquist, only for even n_fft)
Normalising by sum(w) (not n_fft) keeps amplitudes correct under zero-padding.
Zero-padding only interpolates the spectrum; true resolution is set by the
observed duration (about fs/N_signal times the window main-lobe width).
"""
from __future__ import annotations

import numpy as np
from scipy.signal import find_peaks, get_window

MAX_NFFT = 2 ** 22


def make_window(name: str, n: int) -> np.ndarray:
    name = name.lower()
    if name in ("rect", "rectangular", "boxcar"):
        return np.ones(n)
    if name == "hann":
        return get_window("hann", n, fftbins=False)
    raise ValueError(f"unsupported window '{name}' (use 'rect' or 'hann')")


def single_sided_spectrum(x: np.ndarray, fs: float, window: str = "hann",
                          n_fft: int | None = None) -> dict:
    x = np.asarray(x, dtype=np.float64)
    if x.ndim != 1:
        raise ValueError("x must be a 1-D channel")
    n = x.size
    if n < 2:
        raise ValueError("need at least 2 samples")
    n_fft = n if n_fft is None else int(n_fft)
    if n_fft < n:
        raise ValueError("n_fft must be >= signal length (no silent truncation)")
    if n_fft > MAX_NFFT:
        raise ValueError(f"n_fft exceeds safe maximum {MAX_NFFT}")
    w = make_window(window, n)
    sw = float(np.sum(w))
    amp = np.abs(np.fft.rfft(x * w, n=n_fft)) / sw
    if n_fft % 2 == 0:
        amp[1:-1] *= 2.0          # keep DC and Nyquist undoubled
    else:
        amp[1:] *= 2.0            # odd length: no Nyquist bin
    freqs = np.fft.rfftfreq(n_fft, d=1.0 / fs)
    return {
        "freqs_hz": freqs, "amplitude": amp, "power": amp ** 2 / 2.0,
        "window": window, "n_fft": n_fft, "n_signal": n,
        "bin_spacing_hz": fs / n_fft, "nominal_resolution_hz": fs / n,
        "nyquist_hz": fs / 2.0, "coherent_gain": sw / n,
        "amplitude_unit": "single-sided peak amplitude, full scale = 1.0",
        "power_unit": "mean-square power of the equivalent sinusoid (amplitude^2/2)",
    }


def find_spectral_peaks(freqs: np.ndarray, amp: np.ndarray, n_peaks: int = 5,
                        min_rel_height: float = 0.05) -> list[dict]:
    """Dominant spectral peaks (parabolic interpolation on log amplitude).

    These are estimates of spectral peaks, not proof of true source frequencies.
    """
    if amp.size < 3 or np.max(amp) <= 0:
        return []
    idx, _ = find_peaks(amp, height=float(np.max(amp)) * min_rel_height)
    order = idx[np.argsort(amp[idx])[::-1]][:n_peaks]
    df = freqs[1] - freqs[0]
    out = []
    for k in order:
        f, a = float(freqs[k]), float(amp[k])
        if 0 < k < amp.size - 1 and amp[k - 1] > 0 and amp[k + 1] > 0:
            la, lb, lc = np.log(amp[k - 1]), np.log(amp[k]), np.log(amp[k + 1])
            denom = la - 2 * lb + lc
            if denom != 0:
                delta = 0.5 * (la - lc) / denom
                if abs(delta) <= 1:
                    f = float(freqs[k] + delta * df)
                    a = float(np.exp(lb - 0.25 * (la - lc) * delta))
        out.append({"frequency_hz": f, "amplitude": a})
    return out
