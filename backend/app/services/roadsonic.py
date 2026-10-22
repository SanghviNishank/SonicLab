"""RoadSonic orchestration: preprocessing -> features -> detection -> display payloads (no HTTP here)."""
from __future__ import annotations
import numpy as np
from app.processing import filters as flt, enhance as enh, fft_analysis as fa, spectrogram as sg
from app.processing.siren_features import extract_features
from app.processing.siren_detector import DetectorConfig, SENSITIVITY, detect_candidate_sirens
from app.schemas.roadsonic_params import PARAMS

TRACK_KEYS = ["time_s", "rms_db", "centroid_hz", "bandwidth_hz", "flatness", "dom_freq_hz", "peak_prominence_db", "tonal_ratio", "zcr"]


def to_mono(x: np.ndarray, mode: str, remove_dc: bool) -> tuple[np.ndarray, list[dict]]:
    steps = []
    if mode == "mix":
        mono = x.mean(axis=0)
        steps.append({"step": "mono_mix", "detail": "channel average; out-of-phase content cancels" if x.shape[0] > 1 else "single channel"})
    else:
        if int(mode) >= x.shape[0]:
            raise ValueError("channel out of range")
        mono = x[int(mode)].copy()
        steps.append({"step": "channel_select", "detail": f"channel {mode}"})
    if remove_dc:
        mono = mono - mono.mean(); steps.append({"step": "dc_removal", "detail": "subtract mean"})
    return mono, steps


def preprocess(x: np.ndarray, fs: float, cfg) -> dict:
    """Returns {'original': mono, 'processed': mono|None, 'steps': [...]}. The input array is never modified."""
    mono, steps = to_mono(x, cfg.channel_mode, cfg.remove_dc)
    out = {"original": mono, "processed": None, "steps": steps, "processing_steps": []}
    if not cfg.active:
        return out
    y, ps = mono, []
    if cfg.filter.type != "none":
        r = flt.run_filter(y, fs, cfg.filter.type, cfg.filter.order, cfg.filter.cutoff_hz, cfg.filter.method)
        y = r["output"][0]; ps.append({"step": "filter", "detail": r["config"], "warnings": r["warnings"]})
    if cfg.noise_reduction.enabled:
        r = enh.spectral_wiener(y, fs, cfg.noise_reduction.strength, cfg.noise_reduction.max_reduction_db)
        y = r["y"]; ps.append({"step": "noise_reduction", "detail": {"method": r["method"], "strength": cfg.noise_reduction.strength,
                                                                       "max_reduction_db": cfg.noise_reduction.max_reduction_db, "mean_gain_db": r["mean_gain_db"]}})
    out["processed"] = y; out["processing_steps"] = ps
    return out


def detector_config(req) -> DetectorConfig:
    if req.sensitivity:                       # a sensitivity preset overrides the four threshold fields it defines
        d = req.detector.model_dump(); d.update(SENSITIVITY[req.sensitivity]); return DetectorConfig(**d)
    return DetectorConfig(**req.detector.model_dump())


def analyze(mono: np.ndarray, fs: float, req) -> dict:
    f = req.features
    if f.band_hi >= fs / 2:
        raise ValueError(f"band_hi ({f.band_hi} Hz) must be below Nyquist ({fs / 2} Hz) for this recording")
    feat = extract_features(mono, fs, f.frame_ms, f.hop_ms, f.band_lo, f.band_hi)
    res = detect_candidate_sirens(feat, detector_config(req))
    return {"feat": feat, "events": res["events"], "detector": res["config"]}


def tracks_payload(feat: dict, max_points: int = 1500) -> dict:
    n = feat["time_s"].size
    idx = np.unique(np.linspace(0, n - 1, min(n, max_points)).astype(int))
    return {k: np.round(feat[k][idx], 4).tolist() for k in TRACK_KEYS}


def spectrum_payload(mono: np.ndarray, fs: float, max_samples: int = 2 ** 21) -> dict:
    seg, note = mono, "whole recording"
    if mono.size > max_samples:
        s = (mono.size - max_samples) // 2; seg = mono[s:s + max_samples]
        note = f"centre {max_samples / fs:.1f} s of the recording (limit {max_samples} samples)"
    sp = fa.single_sided_spectrum(seg, fs, "hann")
    keep = np.unique(np.linspace(0, sp["freqs_hz"].size - 1, 6000).astype(int)) if sp["freqs_hz"].size > 6000 else np.arange(sp["freqs_hz"].size)
    return {"freqs_hz": sp["freqs_hz"][keep].tolist(), "amplitude": sp["amplitude"][keep].tolist(), "analysed": note,
            "peaks": fa.find_spectral_peaks(sp["freqs_hz"], sp["amplitude"], 5), "bin_spacing_hz": sp["bin_spacing_hz"],
            "window": "hann", "unit": sp["amplitude_unit"]}


def spectrogram_payload(mono: np.ndarray, fs: float, frame: int = 1024, max_frames: int = 4000) -> dict:
    need = int(np.ceil(mono.size / max_frames))          # hop needed to stay within max_frames
    while need > frame and frame < 8192:                  # long audio: lengthen the frame instead of dropping overlap below 0
        frame *= 2
    hop = min(max(frame // 4, need), frame)
    S = sg.stft_db(mono, fs, frame, hop)
    db = S["magnitude_db"]
    st_t = max(1, -(-db.shape[1] // 600)); st_f = max(1, -(-db.shape[0] // 200))      # ceil: at most 600 x 200 cells are sent
    return {"times_s": S["times_s"][::st_t].tolist(), "freqs_hz": S["freqs_hz"][::st_f].tolist(),
            "magnitude_db": np.round(db[::st_f, ::st_t], 1).tolist(), "reference": S["reference"],
            "frame_length": S["frame_length"], "hop_length": S["hop_length"],
            "note": "display-decimated; event times share the audio's seconds axis; frame centre = (m*hop + frame/2)/fs"}


def defaults_payload() -> dict:
    groups: dict = {}
    for name, (d, lo, hi, unit, group, label, help_) in PARAMS.items():
        groups.setdefault(group, {})[name] = {"default": d, "min": lo, "max": hi, "unit": unit, "label": label, "help": help_}
    return {"params": groups, "sensitivity_presets": SENSITIVITY,
            "sensitivity_note": "Higher sensitivity admits weaker evidence: it finds more weak sirens AND more false alarms. It is not 'better'.",
            "features_help": {
                "rms_db": "Short-time level (dBFS). Shows when something loud happens; says nothing about what it is.",
                "centroid_hz": "Spectral 'centre of mass' in the search band. Tones sit near their frequency; noise spreads.",
                "bandwidth_hz": "Spread around the centroid. Small for a pure tone, large for noise.",
                "flatness": "Geometric/arithmetic mean of band power. 1 = noise-like, near 0 = tonal.",
                "dom_freq_hz": "Frequency of the strongest spectral peak per frame. Sirens make it sweep or alternate.",
                "peak_prominence_db": "How far the strongest peak stands above the median band power.",
                "tonal_ratio": "Share of energy in the dominant peak (relative to a wider context band).",
                "zcr": "Zero-crossing rate. Rises with frequency; weak evidence on its own."}}


def event_clip(src: np.ndarray, fs: float, event: dict, pre: float, post: float):
    """Cut [start-pre, end+post] (clamped to the recording) from src (channels, samples). Returns (clip, i0, i1) in samples."""
    if not (0 <= pre <= 30 and 0 <= post <= 30):
        raise ValueError("pre and post context must be within 0-30 s")
    dur = src.shape[1] / fs
    i0 = int(round(max(0.0, event["start_s"] - pre) * fs)); i1 = int(round(min(dur, event["end_s"] + post) * fs))
    return src[:, i0:i1], i0, i1


def run(x: np.ndarray, fs: float, req) -> dict:
    """Full RoadSonic analysis for a request (preprocess -> detect on the chosen version -> optional comparison -> display payloads).
    Raises ValueError/FilterError on invalid combinations; never modifies x."""
    pre = preprocess(x, fs, req.preprocessing)
    active = pre["processed"] is not None
    if req.detect_on == "processed" and not active:
        raise ValueError("detect_on='processed' but no filter or noise reduction is configured")
    use = "processed" if (req.detect_on == "processed" or (req.detect_on == "auto" and active)) else "original"
    chosen = pre[use]
    main = analyze(chosen, fs, req)
    other = None
    if req.compare and active:
        o = "original" if use == "processed" else "processed"
        other = (o, analyze(pre[o], fs, req))
    return {"pre": pre, "active": active, "use": use, "chosen": chosen, "main": main, "other": other,
            "spectrum": spectrum_payload(chosen, fs), "spectrogram": spectrogram_payload(chosen, fs),
            "spectrogram_original": spectrogram_payload(pre["original"], fs) if active else None}
