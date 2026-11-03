"""Before-vs-after comparison measurements: levels, clipping, duration and loudness matching. Pure functions on real arrays."""
from __future__ import annotations
import numpy as np
from app.processing import statistics as st

CLIP_NOTE = "Clipped = samples within 0.1 % of full scale (|x| >= 0.999); this counts samples, it does not prove audible distortion."


def _combined_rms(x: np.ndarray) -> float:
    x = np.atleast_2d(np.asarray(x, dtype=np.float64))
    return float(np.sqrt(np.mean(x ** 2))) if x.size else 0.0


def match_gain_db(x: np.ndarray, y: np.ndarray) -> float | None:
    """Gain (dB) that gives the processed signal the same overall RMS as the original. None if either is digital silence."""
    rx, ry = _combined_rms(x), _combined_rms(y)
    if rx <= 0 or ry <= 0:
        return None
    return float(20 * np.log10(rx / ry))


def _chan(s: dict) -> list[dict]:
    return [{"rms": c["rms"], "peak": c["peak_abs"], "mean": c["mean"], "clipped_samples": c["clipped_samples"],
             "rms_dbfs": (20 * np.log10(c["rms"]) if c["rms"] > 0 else None), "peak_dbfs": (20 * np.log10(c["peak_abs"]) if c["peak_abs"] > 0 else None)}
            for c in s["per_channel"]]


def levels(x: np.ndarray, y: np.ndarray, fs: float) -> dict:
    x, y = np.atleast_2d(x), np.atleast_2d(y)
    sx, sy = st.audio_statistics(x, fs), st.audio_statistics(y.astype(np.float64), fs)
    g = match_gain_db(x, y)
    peak_after_match = None if g is None else float(max(c["peak_abs"] for c in sy["per_channel"]) * 10 ** (g / 20))
    notes = [CLIP_NOTE, "RMS and peak are relative to full scale = 1.0. A lower RMS does not mean noise was removed."]
    if g is not None and peak_after_match is not None and peak_after_match > 1.0:
        notes.append(f"Loudness matching would raise the processed peak to {peak_after_match:.2f} (above full scale); the browser will clip it on playback. Compare with matching off.")
    return {"sample_rate": float(fs), "original": {"duration_s": sx["duration_s"], "samples_per_channel": sx["samples_per_channel"], "channels": _chan(sx)},
            "processed": {"duration_s": sy["duration_s"], "samples_per_channel": sy["samples_per_channel"], "channels": _chan(sy)},
            "duration_difference_s": sy["duration_s"] - sx["duration_s"], "same_length": x.shape == y.shape,
            "loudness_match_gain_db": g, "peak_after_loudness_match": peak_after_match, "notes": notes}
