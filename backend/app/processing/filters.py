"""Butterworth IIR filtering (second-order sections).

Pipeline: validate -> Nyquist -> design (butter, output='sos') -> apply per channel
-> report. Methods:
  * 'causal'     : sosfilt, one forward pass, zero initial state. Introduces phase delay.
                   Magnitude response = |H(f)|.
  * 'zero_phase' : sosfiltfilt (forward-backward, odd edge padding). NONCAUSAL (uses
                   future samples), zero phase, magnitude response = |H(f)|^2
                   (cutoff attenuation -6 dB instead of -3 dB). Not for real-time use.
"""
from __future__ import annotations

import numpy as np
from scipy import signal

MIN_ORDER, MAX_ORDER = 1, 12
FILTER_TYPES = ("lowpass", "highpass", "bandpass", "bandstop")
METHODS = ("causal", "zero_phase")


class FilterError(ValueError):
    pass


def validate_filter(filter_type: str, order: int, cutoff: list[float], fs: float, method: str) -> None:
    if filter_type not in FILTER_TYPES:
        raise FilterError(f"filter_type must be one of {FILTER_TYPES}")
    if method not in METHODS:
        raise FilterError(f"method must be one of {METHODS}")
    if not (isinstance(order, (int, np.integer)) and MIN_ORDER <= order <= MAX_ORDER):
        raise FilterError(f"order must be an integer in [{MIN_ORDER}, {MAX_ORDER}]")
    if not np.isfinite(fs) or fs <= 0:
        raise FilterError("sample rate must be finite and positive")
    c = list(cutoff)
    if not all(np.isfinite(v) and v > 0 for v in c):
        raise FilterError("cutoff frequencies must be finite and positive")
    nyq = fs / 2.0
    if filter_type in ("lowpass", "highpass"):
        if len(c) != 1:
            raise FilterError(f"{filter_type} needs exactly one cutoff frequency")
        if c[0] >= nyq:
            raise FilterError(f"cutoff {c[0]} Hz must be below Nyquist ({nyq} Hz)")
    else:
        if len(c) != 2:
            raise FilterError(f"{filter_type} needs [f_low, f_high]")
        if not (0 < c[0] < c[1] < nyq):
            raise FilterError(f"need 0 < f_low < f_high < Nyquist ({nyq} Hz)")


def design_filter(filter_type: str, order: int, cutoff: list[float], fs: float) -> np.ndarray:
    nyq = fs / 2.0
    wn = [v / nyq for v in cutoff]
    return signal.butter(order, wn[0] if len(wn) == 1 else wn,
                         btype={"lowpass": "lowpass", "highpass": "highpass",
                                "bandpass": "bandpass", "bandstop": "bandstop"}[filter_type],
                         output="sos")


def min_samples_zero_phase(sos: np.ndarray) -> int:
    """Smallest length accepted by sosfiltfilt with default padding (padlen+1)."""
    n_sections = sos.shape[0]
    ntaps = 2 * n_sections + 1 - min(int((sos[:, 2] == 0).sum()), int((sos[:, 5] == 0).sum()))
    return 3 * ntaps + 1


def apply_filter(x: np.ndarray, sos: np.ndarray, method: str) -> np.ndarray:
    """x: (channels, samples). Each channel is filtered independently, one at a time (identical result to filtering the
    whole array along the last axis, but peak memory is one channel's temporaries instead of all channels')."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim == 1:
        x = x[None, :]
    if method != "causal":
        need = min_samples_zero_phase(sos)
        if x.shape[-1] < need:
            raise FilterError(f"recording too short for zero-phase filtering ({x.shape[-1]} < {need} samples); "
                              "use the causal method or a lower order")
    fn = signal.sosfilt if method == "causal" else signal.sosfiltfilt
    out = np.empty_like(x)
    for i in range(x.shape[0]):
        out[i] = fn(sos, x[i])
    return out


def frequency_response(sos: np.ndarray, fs: float, method: str, n_points: int = 2048) -> dict:
    w, h = signal.sosfreqz(sos, worN=n_points, fs=fs)
    mag = np.abs(h)
    if method == "zero_phase":
        mag = mag ** 2
        phase = np.zeros_like(mag)
    else:
        phase = np.unwrap(np.angle(h))
    return {"freqs_hz": w, "magnitude": mag,
            "magnitude_db": 20 * np.log10(np.maximum(mag, 1e-12)), "phase_rad": phase,
            "effective": "|H|^2 (forward-backward)" if method == "zero_phase" else "|H| (single pass)"}


def run_filter(x: np.ndarray, fs: float, filter_type: str, order: int, cutoff: list[float],
               method: str = "zero_phase") -> dict:
    validate_filter(filter_type, order, cutoff, fs, method)
    sos = design_filter(filter_type, order, cutoff, fs)
    y = apply_filter(x, sos, method)
    warnings = []
    if method == "zero_phase":
        warnings.append("Zero-phase filtering is noncausal (uses past and future samples); "
                        "edges use odd-extension padding, so the first/last few cutoff periods may show edge effects.")
    else:
        warnings.append("Causal filtering delays the signal (non-zero phase); transients are shifted in time.")
    n = np.atleast_2d(x).shape[-1]
    edge = int(min(n, np.ceil(fs * order / min(cutoff))))  # rule of thumb: ~order cycles of the lowest cutoff
    warnings.append(f"Estimated edge-effect region: about {edge} samples ({edge / fs:.3f} s) at each end "
                    "(rule of thumb, not an exact bound).")
    warnings.append("A filter removes any content inside its stop band, including wanted content that overlaps it.")
    return {"output": y, "sos": sos, "response": frequency_response(sos, fs, method),
            "config": {"filter_type": filter_type, "order": int(order), "cutoff_hz": [float(v) for v in cutoff],
                       "method": method, "sample_rate": float(fs), "nyquist_hz": fs / 2.0,
                       "design": "Butterworth, second-order sections", "engine": "python-scipy",
                       "edge_effect_samples_estimate": edge},
            "warnings": warnings}


def preview_response(filter_type: str, order: int, cutoff: list[float], fs: float, method: str = "zero_phase", n_points: int = 1024) -> dict:
    """Designs the filter and returns its theoretical response WITHOUT touching any audio (validates exactly like run_filter)."""
    validate_filter(filter_type, order, cutoff, fs, method)
    sos = design_filter(filter_type, order, cutoff, fs)
    resp = frequency_response(sos, fs, method, n_points)
    at = []
    for fc in cutoff:
        k = int(np.argmin(np.abs(resp["freqs_hz"] - fc)))
        at.append({"frequency_hz": float(fc), "magnitude_db": float(resp["magnitude_db"][k])})
    return {"settings": {"filter_type": filter_type, "order": int(order), "cutoff_hz": [float(c) for c in cutoff], "method": method,
                         "sample_rate": float(fs), "nyquist_hz": fs / 2.0, "normalized_cutoff": [float(c) / (fs / 2.0) for c in cutoff],
                         "design": "Butterworth, second-order sections"},
            "response": resp, "attenuation_at_cutoff": at,
            "explanation": ("Butterworth magnitude is maximally flat in the passband; at the cutoff a single pass is about -3 dB "
                            "(forward-backward doubles the dB: about -6 dB). Higher order = steeper transition band, more ringing.")}
