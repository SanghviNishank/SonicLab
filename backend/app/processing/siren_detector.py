"""Interpretable rule-based detector of CANDIDATE siren events.

Not a certified warning system. The score is a heuristic in [0,1], not a probability.

Rules, evaluated on sliding windows of `window_s` seconds over frame features:
  R1 level      : frame rms_db >= min_rms_db (absolute floor; rejects digital silence)
  R2 tonality   : frame tonal_ratio >= min_tonal_ratio  -> frame is 'tonal'
  R3 persistence: fraction of tonal frames in window >= min_tonal_fraction
  R4 modulation : robust range (p95-p5) of dominant frequency over tonal frames
                  >= min_f0_range_hz  (a steady horn/tone has ~0 range)
  R5 variation  : std of dominant frequency over tonal frames >= min_f0_std_hz
Reasons: sirens are strongly tonal (R2,R3) AND sweep or alternate in frequency
(R4,R5), unlike steady horns/musical tones (tonal but unmodulated), broadband
traffic/wind noise (not tonal), and most speech (intermittent, low-level peaks).
Windows passing all rules are merged (gaps <= merge_gap_s) and events shorter
than min_event_s are discarded.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import numpy as np


@dataclass
class DetectorConfig:
    window_s: float = 1.0
    window_step_s: float = 0.1
    min_rms_db: float = -60.0
    min_tonal_ratio: float = 0.5
    min_tonal_fraction: float = 0.6
    min_f0_range_hz: float = 150.0
    min_f0_std_hz: float = 40.0
    merge_gap_s: float = 0.5
    min_event_s: float = 1.0


def detect_candidate_sirens(feat: dict, cfg: DetectorConfig | None = None) -> dict:
    cfg = cfg or DetectorConfig()
    t = feat["time_s"]
    hop_s = feat["meta"]["hop_ms"] / 1000.0
    nf = t.size
    tonal = (feat["tonal_ratio"] >= cfg.min_tonal_ratio) & (feat["rms_db"] >= cfg.min_rms_db)
    f0 = feat["dom_freq_hz"]
    wf = max(2, int(round(cfg.window_s / hop_s)))
    step = max(1, int(round(cfg.window_step_s / hop_s)))
    starts = list(range(0, max(1, nf - wf + 1), step))
    win_ok, win_info = [], []
    for s in starts:
        sl = slice(s, min(nf, s + wf))
        m = tonal[sl]
        frac = float(m.mean())
        v = f0[sl][m]
        rng = float(np.percentile(v, 95) - np.percentile(v, 5)) if v.size >= 3 else 0.0
        sd = float(v.std()) if v.size >= 3 else 0.0
        ok = frac >= cfg.min_tonal_fraction and rng >= cfg.min_f0_range_hz and sd >= cfg.min_f0_std_hz
        win_ok.append(ok)
        win_info.append((s, min(nf, s + wf), frac, rng, sd))
    # merge passing windows into frame intervals
    intervals = []
    for ok, (a, b, *_rest) in zip(win_ok, win_info):
        if ok:
            ta, tb = float(t[a]), float(t[b - 1])
            if intervals and ta - intervals[-1][1] <= cfg.merge_gap_s:
                intervals[-1][1] = max(intervals[-1][1], tb)
                intervals[-1][2].append((a, b))
            else:
                intervals.append([ta, tb, [(a, b)]])
    events = []
    for ta, tb, wins in intervals:
        mask = (t >= ta) & (t <= tb)
        tm = mask & tonal
        if not tm.any():
            continue
        # trim window-based interval to the first/last tonal frame it contains
        half = feat["meta"]["frame_ms"] / 2000.0
        ta, tb = float(t[tm][0] - half), float(t[tm][-1] + half)
        mask = (t >= ta) & (t <= tb)
        tm = mask & tonal
        v = f0[tm]
        frac = float(tonal[mask].mean())
        rng = float(np.percentile(v, 95) - np.percentile(v, 5)) if v.size >= 3 else 0.0
        sd = float(v.std()) if v.size >= 3 else 0.0
        score = float(np.mean([min(1.0, frac / 1.0), min(1.0, rng / (3 * cfg.min_f0_range_hz)),
                               min(1.0, float(feat["tonal_ratio"][tm].mean()) if tm.any() else 0.0)]))
        if tb - ta < cfg.min_event_s:
            continue
        events.append({
            "start_s": ta, "end_s": tb, "duration_s": tb - ta,
            "method": "rule-based tonal+frequency-modulation (v1)",
            "features": {"tonal_fraction": frac, "f0_range_hz": rng, "f0_std_hz": sd,
                         "mean_tonal_ratio": float(feat["tonal_ratio"][tm].mean()) if tm.any() else 0.0,
                         "mean_rms_db": float(feat["rms_db"][mask].mean()),
                         "mean_centroid_hz": float(feat["centroid_hz"][mask].mean()),
                         "mean_bandwidth_hz": float(feat["bandwidth_hz"][mask].mean()),
                         "f0_min_hz": float(v.min()) if v.size else None,
                         "f0_max_hz": float(v.max()) if v.size else None},
            "rules": {"R2_tonality": cfg.min_tonal_ratio, "R3_persistence": frac >= cfg.min_tonal_fraction,
                      "R4_modulation": rng >= cfg.min_f0_range_hz, "R5_variation": sd >= cfg.min_f0_std_hz},
            "heuristic_score": score,
            "label": "candidate siren event",
            "note": "heuristic score, not a calibrated probability",
        })
    return {"events": events, "config": asdict(cfg)}
