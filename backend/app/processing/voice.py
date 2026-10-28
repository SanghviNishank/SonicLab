"""Voice-enhancement pipeline: independent, configurable, individually testable stages.

Stages (all optional, executed in this order, each recorded in the processing history):
  1 dc_removal     : subtract the per-channel mean.
  2 rumble         : Butterworth high-pass (default 80 Hz) against low-frequency rumble.
  3 band_limit     : optional low-pass and/or high-pass band limiting (speech-focused).
  4 noise_reduction: stationary spectral gating (see spectral_gate).
  5 loudness       : optional peak-limited gain; never clips (gain is capped by headroom).
No stage is on by default except where a preset says so. A filter is NOT a denoiser: stage 2/3 remove
frequency ranges, stage 4 estimates and attenuates a *stationary* noise spectrum.
"""
from __future__ import annotations
from copy import deepcopy
import numpy as np
from scipy import signal
from scipy.ndimage import uniform_filter1d
from scipy.signal import lfilter
from . import filters as flt
from . import enhance as enh, vad as vadmod, stft_lean

MAX_FRAME = 8192


# ---------------------------------------------------------------- spectral gating
def estimate_noise_psd(power: np.ndarray, mode: str = "quietest", quantile: float = 0.1):
    """power: (bins, frames). 'quietest' = mean power of the frames whose total energy is in the lowest
    `quantile` (works without a labelled noise-only section but is only meaningful if such frames exist)."""
    energy = power.sum(axis=0)
    k = max(1, int(np.ceil(quantile * energy.size)))
    idx = np.argsort(energy)[:k]
    noise = power[:, idx].mean(axis=1)
    # confidence: is the quietest part clearly quieter than the median frame?
    med = float(np.median(energy)); q = float(energy[idx].mean())
    gap_db = 10 * np.log10(max(med, 1e-30) / max(q, 1e-30))
    return noise, gap_db


def spectral_gate(x: np.ndarray, fs: float, strength: float = 0.6, max_reduction_db: float = 18.0,
                  frame_length: int = 2048, noise_segment_s: tuple[float, float] | None = None,
                  smooth_time: float = 0.6, smooth_freq_bins: int = 3) -> dict:
    """Spectral subtraction with a gain floor, on a 75 %-overlap Hann STFT (COLA, exact overlap-add).

    P = |X|^2,  N = noise power per bin,  alpha = 1 + 2*strength (over-subtraction)
    G = max(1 - alpha*N/P, g_min)^(1/2 on power ratio -> amplitude),  g_min = 10^(-max_reduction_db/20)
    Gain is smoothed over frequency (moving average) and time (one-pole) to reduce 'musical noise'.
    Noise estimate: user segment (seconds) or automatic quietest frames. Phase of the noisy signal is kept.
    Returns y (same length as x) and diagnostics."""
    x = np.asarray(x, dtype=np.float64)
    if x.ndim != 1: raise ValueError("expected 1-D channel")
    if not 0.0 <= strength <= 1.0: raise ValueError("strength must be within [0, 1]")
    if not 0.0 < max_reduction_db <= 60.0: raise ValueError("max_reduction_db must be within (0, 60]")
    L = int(frame_length)
    if L < 256 or L > MAX_FRAME or L & (L - 1): raise ValueError("frame_length must be a power of two in [256, 8192]")
    if x.size < 2 * L:
        raise ValueError(f"recording too short for noise reduction (need >= {2 * L} samples)")
    hop = L // 4
    t, Z = stft_lean.stft(x, fs, L, hop)                     # same numbers as scipy.signal.stft, chunked (bit-identical, tested)
    P = np.abs(Z)
    np.square(P, out=P)                                     # |Z|^2 in place
    warn = []
    if noise_segment_s is not None:
        a, b = noise_segment_s
        if not (0 <= a < b <= x.size / fs): raise ValueError("noise segment must lie inside the recording")
        sel = (t >= a) & (t <= b)
        if sel.sum() < 3: raise ValueError("noise segment too short (need >= 3 frames)")
        noise = P[:, sel].mean(axis=1); source = "user segment"; gap = None
    else:
        noise, gap = estimate_noise_psd(P); source = "quietest 10% of frames"
        if gap < 3.0:
            warn.append(f"No clearly quieter (noise-only) section found (quietest frames only {gap:.1f} dB below median): "
                        "the noise estimate may include speech and the result may attenuate wanted sound. "
                        "Select a noise-only segment if one exists.")
    if np.all(noise <= 0):
        return {"y": x.copy(), "bypassed": True, "warnings": ["digital silence in noise estimate; nothing to reduce"],
                "noise_source": source, "mean_gain_db": 0.0}
    alpha = 1.0 + 2.0 * strength
    gmin = 10 ** (-max_reduction_db / 20)
    G = np.maximum(P, 1e-30)                                # G = sqrt(max(1 - alpha*N/P, gmin^2)), computed in place on one array
    del P
    np.divide(alpha * noise[:, None], G, out=G)
    np.subtract(1.0, G, out=G)
    np.maximum(G, gmin ** 2, out=G)
    np.sqrt(G, out=G)
    if smooth_freq_bins > 1:
        if smooth_freq_bins % 2 == 1:                       # centred moving average with zero padding == np.convolve(r, ones/k, "same")
            G = uniform_filter1d(G, size=smooth_freq_bins, axis=0, mode="constant", cval=0.0)
        else:
            k = np.ones(smooth_freq_bins) / smooth_freq_bins
            G = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 0, G)
    if 0 < smooth_time < 1:
        # one-pole smoothing g[j] = a*g[j-1] + (1-a)*G[j], g[0] = G[0] (slow release); lfilter with zi = a*G[0] reproduces it exactly
        G = lfilter([1.0 - smooth_time], [1.0, -smooth_time], G, axis=1, zi=smooth_time * G[:, :1])[0]
        np.maximum(G, gmin, out=G)
    Z *= G
    y = stft_lean.istft(Z, L, hop)
    del Z
    y = y[: x.size]
    if y.size < x.size: y = np.pad(y, (0, x.size - y.size))
    return {"y": y, "bypassed": False, "warnings": warn, "noise_source": source, "noise_gap_db": gap,
            "mean_gain_db": float(20 * np.log10(np.mean(G) + 1e-12)), "frame_length": L, "hop_length": hop,
            "alpha": alpha, "gain_floor_db": -max_reduction_db}


# ---------------------------------------------------------------- pipeline
DEFAULT_CONFIG = {
    "dc_removal": {"enabled": False},
    "rumble": {"enabled": False, "cutoff_hz": 80.0, "order": 4},
    "band_limit": {"enabled": False, "highpass_hz": None, "lowpass_hz": None, "order": 4},
    "noise_reduction": {"enabled": False, "method": "gate", "strength": 0.6, "max_reduction_db": 18.0, "frame_length": 2048,
                        "noise_segment_s": None},
    "speech_gate": {"enabled": False, "attenuation_db": 12.0},
    "loudness": {"enabled": False, "target_peak_dbfs": -1.0},
    "peak_guard": {"enabled": True, "ceiling_dbfs": -0.5},
    "method": "zero_phase",
}

PRESETS = {
    "natural_voice": {"description": "Gentle: DC removal and a 60 Hz rumble high-pass only.",
                      "config": {"dc_removal": {"enabled": True}, "rumble": {"enabled": True, "cutoff_hz": 60.0, "order": 2}}},
    "speech_clarity": {"description": "DC removal, 80 Hz rumble cut, moderate spectral gating (strength 0.5).",
                       "config": {"dc_removal": {"enabled": True}, "rumble": {"enabled": True, "cutoff_hz": 80.0, "order": 4},
                                  "noise_reduction": {"enabled": True, "strength": 0.5, "max_reduction_db": 15.0}}},
    "low_rumble": {"description": "Removes content below 100 Hz (traffic, handling, wind thumps). No noise reduction.",
                   "config": {"dc_removal": {"enabled": True}, "rumble": {"enabled": True, "cutoff_hz": 100.0, "order": 4}}},
    "fan_noise": {"description": "80 Hz rumble cut + stronger spectral gating (strength 0.8) for steady fan/AC noise.",
                  "config": {"dc_removal": {"enabled": True}, "rumble": {"enabled": True, "cutoff_hz": 80.0, "order": 4},
                             "noise_reduction": {"enabled": True, "strength": 0.8, "max_reduction_db": 24.0}}},
    "stationary_hiss": {"description": "Spectral gating (strength 0.7) + 8 kHz low-pass for steady hiss.",
                        "config": {"dc_removal": {"enabled": True},
                                   "band_limit": {"enabled": True, "highpass_hz": None, "lowpass_hz": 8000.0, "order": 4},
                                   "noise_reduction": {"enabled": True, "strength": 0.7, "max_reduction_db": 20.0}}},
    "telephone_band": {"description": "300-3400 Hz band-limit. Removes consonant detail above 3.4 kHz: sounds 'phone-like'.",
                       "config": {"dc_removal": {"enabled": True},
                                  "band_limit": {"enabled": True, "highpass_hz": 300.0, "lowpass_hz": 3400.0, "order": 4}}},
    "lecture_speech": {"description": "For a talker recorded with steady/slowly varying background noise: DC removal, 80 Hz high-pass, adaptive Wiener noise "
                                      "tracking (needs no noise-only section), gentle (-10 dB) attenuation of non-speech intervals. "
                                      "Does NOT remove music or other talkers.",
                       "config": {"dc_removal": {"enabled": True}, "rumble": {"enabled": True, "cutoff_hz": 80.0, "order": 4},
                                  "noise_reduction": {"enabled": True, "method": "wiener", "strength": 0.7, "max_reduction_db": 18.0},
                                  "speech_gate": {"enabled": True, "attenuation_db": 10.0}}},
    "manual": {"description": "Everything off; enable stages yourself.", "config": {}},
}


def _merge(base: dict, over: dict) -> dict:
    out = deepcopy(base)
    for k, v in (over or {}).items():
        if isinstance(v, dict) and isinstance(out.get(k), dict): out[k].update(v)
        else: out[k] = v
    return out


def resolve_config(preset: str | None, overrides: dict | None) -> dict:
    if preset is not None and preset not in PRESETS:
        raise ValueError(f"unknown preset '{preset}'; choose from {list(PRESETS)}")
    cfg = _merge(DEFAULT_CONFIG, PRESETS[preset]["config"] if preset else {})
    return _merge(cfg, overrides or {})


def _stats(x2: np.ndarray) -> dict:
    return {"peak": float(np.max(np.abs(x2))), "rms": float(np.sqrt(np.mean(x2 ** 2)))}


def quality_checks(x: np.ndarray, y: np.ndarray, fs: float) -> dict:
    """Sanity checks on the output; `ok` False means 'do not present as successful enhancement'."""
    issues = []
    ok = True
    if y.shape != x.shape:
        issues.append(f"output shape {y.shape} differs from input {x.shape}"); ok = False
    if not np.all(np.isfinite(y)):
        issues.append("output contains NaN/Inf"); ok = False
    rx, ry = _stats(x)["rms"], _stats(y)["rms"]
    if rx > 0 and ry < 1e-4 * rx:
        issues.append("output is essentially silent"); ok = False
    elif rx > 0 and ry < 10 ** (-24 / 20) * rx:
        issues.append(f"severe level loss ({20 * np.log10(ry / rx):.1f} dB RMS)")
    peak = float(np.max(np.abs(y))) if y.size else 0.0
    clipped = int(np.count_nonzero(np.abs(y) >= 0.999))
    if clipped:
        issues.append(f"{clipped} output samples at/above full scale (export as float32 or lower the gain)")
    return {"ok": ok, "issues": issues, "peak": peak, "rms": ry, "rms_input": rx,
            "rms_change_db": float(20 * np.log10(ry / rx)) if rx > 0 and ry > 0 else None,
            "clipped_samples": clipped, "duration_s": y.shape[-1] / fs, "sample_rate": fs, "channels": int(y.shape[0])}


def run_voice_pipeline(x: np.ndarray, fs: float, preset: str | None = None, overrides: dict | None = None) -> dict:
    x = np.atleast_2d(np.asarray(x, dtype=np.float64))
    cfg = resolve_config(preset, overrides)
    method = cfg["method"]
    y = x.copy()                                     # original array is never modified
    history, warnings = [], []

    def log(stage, params, engine="python-scipy"):
        history.append({"stage": stage, "params": params, "engine": engine, **_stats(y)})

    if cfg["dc_removal"]["enabled"]:
        y = y - y.mean(axis=1, keepdims=True)
        log("dc_removal", {"per_channel_mean_removed": [float(m) for m in x.mean(axis=1)]})

    c = cfg["rumble"]
    if c["enabled"]:
        r = flt.run_filter(y, fs, "highpass", int(c["order"]), [float(c["cutoff_hz"])], method)
        y = r["output"]; log("rumble_highpass", r["config"])

    c = cfg["band_limit"]
    if c["enabled"]:
        hp, lp = c.get("highpass_hz"), c.get("lowpass_hz")
        if hp is None and lp is None:
            raise ValueError("band_limit enabled but no cutoff given")
        if hp is not None and lp is not None: typ, cut = "bandpass", [float(hp), float(lp)]
        elif hp is not None: typ, cut = "highpass", [float(hp)]
        else: typ, cut = "lowpass", [float(lp)]
        if cut[-1] >= fs / 2:
            warnings.append(f"requested cutoff {cut[-1]} Hz is not below Nyquist ({fs / 2} Hz); band limit skipped")
            history.append({"stage": "band_limit_skipped", "params": {"requested": cut, "nyquist_hz": fs / 2}, **_stats(y)})
        else:
            r = flt.run_filter(y, fs, typ, int(c["order"]), cut, method)
            y = r["output"]; log("band_limit", r["config"])

    c = cfg["noise_reduction"]
    if c["enabled"]:
        if c.get("method", "gate") not in ("gate", "wiener"):
            raise ValueError("noise_reduction.method must be 'gate' or 'wiener'")
        outs = []
        for ch in y:
            if c.get("method", "gate") == "wiener":
                outs.append(enh.spectral_wiener(ch, fs, float(c["strength"]), float(c["max_reduction_db"]), int(c["frame_length"])))
                outs[-1]["noise_source"] = "adaptive minimum-statistics tracking"
            else:
                seg = tuple(c["noise_segment_s"]) if c.get("noise_segment_s") else None
                outs.append(spectral_gate(ch, fs, float(c["strength"]), float(c["max_reduction_db"]), int(c["frame_length"]), seg))
        y = np.vstack([o["y"] for o in outs])
        for o in outs: warnings += o["warnings"]
        log("noise_reduction", {"method": c.get("method", "gate"), "strength": c["strength"], "max_reduction_db": c["max_reduction_db"],
                                "noise_estimate": outs[0]["noise_source"], "mean_gain_db": [o["mean_gain_db"] for o in outs],
                                "frame_length": int(c["frame_length"])})

    c = cfg["speech_gate"]
    if c["enabled"]:
        v = vadmod.detect_speech(y.mean(axis=0), fs)
        if v["speech_fraction"] == 0:
            warnings.append("Speech gate skipped: no speech-like frames were detected, so nothing would be preserved.")
            history.append({"stage": "speech_gate_skipped", "params": {"reason": "no speech-like frames"}, **_stats(y)})
        else:
            r = enh.vad_attenuate(y, fs, v, float(c["attenuation_db"]))
            y = r["y"]
            log("speech_gate", {"attenuation_db": c["attenuation_db"], "speech_fraction": v["speech_fraction"], "segments": len(v["segments"]),
                                "vad": v["params"], "note": v["note"]})

    c = cfg["loudness"]
    if c["enabled"]:
        peak = float(np.max(np.abs(y)))
        if peak > 0:
            g = 10 ** (float(c["target_peak_dbfs"]) / 20) / peak       # peak-limited by construction: no clipping
            y = y * g
            log("loudness_peak_gain", {"target_peak_dbfs": c["target_peak_dbfs"], "applied_gain_db": float(20 * np.log10(g)),
                                       "note": "single static gain; explicit and reported; not perceptual loudness (LUFS)"})
    c = cfg["peak_guard"]
    if c["enabled"]:
        y2, gdb = enh.peak_guard(y, float(c["ceiling_dbfs"]))
        if gdb != 0.0:
            y = y2
            log("peak_guard", {"ceiling_dbfs": c["ceiling_dbfs"], "applied_gain_db": gdb,
                               "note": "static gain reduction because the peak exceeded the ceiling (filter overshoot or boost); reported, not hidden"})
    q = quality_checks(x, y, fs)
    if not q["ok"]:
        warnings.append("QUALITY CHECK FAILED: " + "; ".join(q["issues"]) + " - do not treat this as a successful enhancement.")
    warnings.append("Quality is measured with signal statistics only; subjective speech quality/intelligibility is not verified.")
    return {"output": y, "config": cfg, "preset": preset, "history": history, "quality": q, "warnings": warnings,
            "engine": "python-scipy"}
