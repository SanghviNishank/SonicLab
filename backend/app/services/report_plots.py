"""Static plots for reports, drawn from the real job arrays (matplotlib is optional)."""
from __future__ import annotations
import io
import numpy as np
from app.processing.statistics import downsample_minmax

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except Exception:  # pragma: no cover
    plt = None

def available() -> bool:
    return plt is not None

def _png(fig) -> bytes:
    buf = io.BytesIO(); fig.savefig(buf, format="png", dpi=110, bbox_inches="tight"); plt.close(fig); return buf.getvalue()

def waveform_compare(x: np.ndarray, y: np.ndarray | None, fs: float, ch: int = 0) -> bytes:
    fig, ax = plt.subplots(figsize=(7, 2.6))
    i, v = downsample_minmax(x[ch], 3000); ax.plot(i / fs, v, lw=0.6, label="original")
    if y is not None:
        i, v = downsample_minmax(y[ch], 3000); ax.plot(i / fs, v, lw=0.6, label="processed", alpha=0.85)
    ax.set_xlabel("Time (s)"); ax.set_ylabel("Amplitude (full scale = 1)"); ax.legend(loc="upper right"); ax.grid(alpha=0.3)
    return _png(fig)

def spectrum_compare(before: dict, after: dict | None) -> bytes:
    fig, ax = plt.subplots(figsize=(7, 2.6))
    ax.semilogy(before["freqs_hz"], np.maximum(before["amplitude"], 1e-9), lw=0.7, label="original")
    if after is not None: ax.semilogy(after["freqs_hz"], np.maximum(after["amplitude"], 1e-9), lw=0.7, label="processed")
    ax.set_xlabel("Frequency (Hz)"); ax.set_ylabel("Amplitude (full scale = 1)"); ax.legend(); ax.grid(alpha=0.3, which="both")
    return _png(fig)

def siren_overview(mono: np.ndarray, fs: float, feat: dict, events: list[dict]) -> bytes:
    fig, (a, b) = plt.subplots(2, 1, figsize=(7, 4.2), sharex=True)
    i, v = downsample_minmax(mono, 3000); a.plot(i / fs, v, lw=0.5)
    b.plot(feat["time_s"], feat["dom_freq_hz"], ".", ms=1.5)
    for ax in (a, b):
        for e in events: ax.axvspan(e["start_s"], e["end_s"], color="orange", alpha=0.3)
    a.set_ylabel("Amplitude"); b.set_ylabel("Dominant freq (Hz)"); b.set_xlabel("Time (s)")
    a.set_title("Shaded = candidate siren events (heuristic, unconfirmed)", fontsize=9)
    return _png(fig)
