"""Interpretable rule-based detector of CANDIDATE siren events.

Not a certified warning system, not machine learning. The evidence score is a heuristic in [0, 1], NOT a probability.

Frame level (from siren_features):  a frame is 'tonal' when
  R1 level       rms_db >= min_rms_db            (rejects digital silence / very quiet frames)
  R2 tonality    tonal_ratio >= min_tonal_ratio   (energy concentrated in one spectral peak)
  R6 prominence  peak_prominence_db >= min_peak_prominence_db   (optional; 0 = off)
Window level (sliding windows of window_s seconds, step window_step_s):  a window passes when
  R3 persistence fraction of tonal frames >= min_tonal_fraction
  R4 modulation  robust range (p95-p5) of the dominant frequency over tonal frames >= min_f0_range_hz
  R5 variation   std of the dominant frequency over tonal frames >= min_f0_std_hz
Passing windows are merged when the gap between them is <= merge_gap_s, each merged interval is trimmed to its first
and last tonal frame, clamped to [0, duration], and kept only if it lasts >= min_event_s. If max_event_s > 0, longer
intervals are split into consecutive pieces of at most max_event_s (documented, off by default).
Why: sirens are strongly tonal AND sweep/alternate in frequency, unlike steady horns (tonal, no modulation), broadband
traffic/wind noise (not tonal) and most speech (intermittent). A siren with a narrow or slow sweep, a distant/weak siren
or a siren masked by loud noise can be missed; modulated horns, alarms, music or sliding tones can be false positives.

Evidence score = mean of three terms, each clipped to [0, 1]:
  tonal term      = tonal fraction inside the event
  modulation term = f0 range / (3 * min_f0_range_hz)
  strength term   = mean tonal_ratio of the tonal frames
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import numpy as np
from scipy.signal import medfilt


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
    max_event_s: float = 0.0            # 0 = no maximum
    min_peak_prominence_db: float = 0.0  # 0 = rule R6 disabled


SENSITIVITY = {
    "low": {"min_tonal_ratio": 0.6, "min_tonal_fraction": 0.7, "min_f0_range_hz": 200.0, "min_f0_std_hz": 55.0},
    "medium": {"min_tonal_ratio": 0.5, "min_tonal_fraction": 0.6, "min_f0_range_hz": 150.0, "min_f0_std_hz": 40.0},
    "high": {"min_tonal_ratio": 0.4, "min_tonal_fraction": 0.5, "min_f0_range_hz": 100.0, "min_f0_std_hz": 25.0},
}


def sensitivity_config(level: str) -> DetectorConfig:
    if level not in SENSITIVITY:
        raise ValueError(f"sensitivity must be one of {list(SENSITIVITY)}")
    return DetectorConfig(**SENSITIVITY[level])


def describe_trajectory(t: np.ndarray, f0: np.ndarray) -> dict:
    """Observed shape of the dominant-frequency track (descriptive only; not a siren-type classification)."""
    if f0.size < 5:
        return {"pattern": "too short to describe", "turning_points": 0}
    sm = medfilt(f0, 5)
    rng = float(sm.max() - sm.min())
    thr = max(0.1 * rng, 1e-9)                 # zig-zag: a reversal counts only if it exceeds 10% of the total range
    hi = lo = float(sm[0]); direction = 0; turns = 0
    for v in sm:
        if direction == 0:
            hi, lo = max(hi, v), min(lo, v)
            if v > lo + thr: direction, hi = 1, v
            elif v < hi - thr: direction, lo = -1, v
        elif direction == 1:
            if v > hi: hi = v
            elif v < hi - thr: direction, lo, turns = -1, v, turns + 1
        else:
            if v < lo: lo = v
            elif v > lo + thr: direction, hi, turns = 1, v, turns + 1
    dur = float(t[-1] - t[0]) if t.size > 1 else 0.0
    if turns >= 2:
        return {"pattern": f"oscillating sweep (~{turns / 2 / max(dur, 1e-9):.2f} cycles/s)", "turning_points": int(turns)}
    return {"pattern": "rising sweep" if sm[-1] > sm[0] else "falling sweep", "turning_points": int(turns)}


def detect_candidate_sirens(feat: dict, cfg: DetectorConfig | None = None) -> dict:
    cfg = cfg or DetectorConfig()
    t = feat["time_s"]
    meta = feat["meta"]
    hop_s = meta["hop_ms"] / 1000.0
    duration = float(meta.get("duration_s", t[-1] + meta["frame_ms"] / 2000.0 if t.size else 0.0))
    nf = t.size
    tonal = (feat["tonal_ratio"] >= cfg.min_tonal_ratio) & (feat["rms_db"] >= cfg.min_rms_db)
    if cfg.min_peak_prominence_db > 0:
        tonal &= feat["peak_prominence_db"] >= cfg.min_peak_prominence_db
    f0 = feat["dom_freq_hz"]
    wf = max(2, int(round(cfg.window_s / hop_s)))
    step = max(1, int(round(cfg.window_step_s / hop_s)))
    half = meta["frame_ms"] / 2000.0

    win_ok, win_bounds = [], []
    for s in range(0, max(1, nf - wf + 1), step):
        e_ = min(nf, s + wf)
        m = tonal[s:e_]
        v = f0[s:e_][m]
        rng = float(np.percentile(v, 95) - np.percentile(v, 5)) if v.size >= 3 else 0.0
        sd = float(v.std()) if v.size >= 3 else 0.0
        win_ok.append(bool(m.mean() >= cfg.min_tonal_fraction and rng >= cfg.min_f0_range_hz and sd >= cfg.min_f0_std_hz))
        win_bounds.append((s, e_))

    intervals = []
    for ok, (a, b) in zip(win_ok, win_bounds):
        if ok:
            ta, tb = float(t[a]), float(t[b - 1])
            if intervals and ta - intervals[-1][1] <= cfg.merge_gap_s:
                intervals[-1][1] = max(intervals[-1][1], tb)
            else:
                intervals.append([ta, tb])

    def make_event(ta: float, tb: float, note: str | None = None, bounded: bool = False):
        mask = (t >= ta) & (t <= tb)
        tm = mask & tonal
        if not tm.any():
            return None
        ta2 = max(0.0, float(t[tm][0] - half)); tb2 = min(duration, float(t[tm][-1] + half))
        if bounded:                                   # split pieces must not overlap their neighbours
            ta2, tb2 = max(ta2, ta), min(tb2, tb)
        if not tb2 > ta2 or tb2 - ta2 < cfg.min_event_s:
            return None
        mask = (t >= ta2) & (t <= tb2)
        tm = mask & tonal
        v, tv = f0[tm], t[tm]
        frac = float(tonal[mask].mean())
        rng = float(np.percentile(v, 95) - np.percentile(v, 5)) if v.size >= 3 else 0.0
        sd = float(v.std()) if v.size >= 3 else 0.0
        strength = float(feat["tonal_ratio"][tm].mean()) if tm.any() else 0.0
        terms = {"tonal_fraction": min(1.0, frac), "modulation": min(1.0, rng / max(3 * cfg.min_f0_range_hz, 1e-9)), "tonal_strength": min(1.0, strength)}
        score = float(np.mean(list(terms.values())))
        traj = describe_trajectory(tv, v)
        keep = np.unique(np.linspace(0, tv.size - 1, min(tv.size, 150)).astype(int)) if tv.size else np.array([], int)
        rules = {"R1_level": bool(feat["rms_db"][mask].mean() >= cfg.min_rms_db), "R2_tonality": bool(strength >= cfg.min_tonal_ratio),
                 "R3_persistence": bool(frac >= cfg.min_tonal_fraction), "R4_modulation": bool(rng >= cfg.min_f0_range_hz),
                 "R5_variation": bool(sd >= cfg.min_f0_std_hz)}
        expl = (f"Tonal in {100 * frac:.0f}% of frames (needs >= {100 * cfg.min_tonal_fraction:.0f}%); dominant frequency "
                f"{v.min():.0f}-{v.max():.0f} Hz, robust range {rng:.0f} Hz (needs >= {cfg.min_f0_range_hz:.0f}), std {sd:.0f} Hz "
                f"(needs >= {cfg.min_f0_std_hz:.0f}); observed pattern: {traj['pattern']}. Flagged because every rule passed. "
                f"This is a heuristic candidate, not a confirmed siren.")
        return {
            "start_s": ta2, "end_s": tb2, "duration_s": tb2 - ta2,
            "method": "rule-based tonal+frequency-modulation (v2)", "label": "candidate siren event",
            "features": {"tonal_fraction": frac, "f0_range_hz": rng, "f0_std_hz": sd, "mean_tonal_ratio": strength,
                         "mean_rms_db": float(feat["rms_db"][mask].mean()), "mean_centroid_hz": float(feat["centroid_hz"][mask].mean()),
                         "mean_bandwidth_hz": float(feat["bandwidth_hz"][mask].mean()), "mean_flatness": float(feat["flatness"][mask].mean()),
                         "mean_peak_prominence_db": float(feat["peak_prominence_db"][tm].mean()) if tm.any() else 0.0,
                         "f0_min_hz": float(v.min()) if v.size else None, "f0_max_hz": float(v.max()) if v.size else None},
            "rules": rules,
            "thresholds": {k: getattr(cfg, k) for k in ("min_rms_db", "min_tonal_ratio", "min_tonal_fraction", "min_f0_range_hz", "min_f0_std_hz")},
            "trajectory": {"time_s": tv[keep].round(4).tolist(), "freq_hz": v[keep].round(2).tolist(), **traj},
            "evidence_terms": terms, "heuristic_score": score,
            "score_definition": "mean of tonal fraction, modulation (range / 3x threshold) and tonal strength, each clipped to [0,1]; heuristic, not a probability",
            "explanation": expl + (f" {note}" if note else ""),
        }

    events = []
    for ta, tb in intervals:
        pieces = [(ta, tb, None)]
        if cfg.max_event_s > 0 and tb - ta > cfg.max_event_s:
            n = int(np.ceil((tb - ta) / cfg.max_event_s))
            pieces = [(ta + i * (tb - ta) / n, ta + (i + 1) * (tb - ta) / n, f"(piece {i + 1}/{n} of an interval longer than max_event_s)") for i in range(n)]
        for a, b, note in pieces:
            ev = make_event(a, b, note, bounded=note is not None)
            if ev: events.append(ev)
    events.sort(key=lambda e: e["start_s"])
    return {"events": events, "config": asdict(cfg)}


def evaluate_events(events: list[dict], truth: list[tuple[float, float]], duration_s: float, min_iou: float = 0.3) -> dict:
    """Event-level evaluation against labelled intervals (greedy one-to-one matching by IoU >= min_iou).
    Reports TP/FP/FN, precision, recall, F1, mean absolute boundary errors and false alarms per minute."""
    truth = [(float(a), float(b)) for a, b in truth]
    for a, b in truth:
        if not (0 <= a < b):
            raise ValueError(f"invalid truth interval ({a}, {b})")
    pred = [(e["start_s"], e["end_s"]) for e in events]
    def iou(p, q):
        inter = max(0.0, min(p[1], q[1]) - max(p[0], q[0])); uni = (p[1] - p[0]) + (q[1] - q[0]) - inter
        return inter / uni if uni > 0 else 0.0
    pairs = sorted(((iou(p, q), i, j) for i, p in enumerate(pred) for j, q in enumerate(truth)), reverse=True)
    used_p, used_t, matches = set(), set(), []
    for v, i, j in pairs:
        if v >= min_iou and i not in used_p and j not in used_t:
            used_p.add(i); used_t.add(j); matches.append((i, j, v))
    tp = len(matches); fp = len(pred) - tp; fn = len(truth) - tp
    prec = tp / (tp + fp) if tp + fp else None
    rec = tp / (tp + fn) if tp + fn else None
    f1 = 2 * prec * rec / (prec + rec) if prec and rec else (0.0 if prec is not None and rec is not None else None)
    start_err = [abs(pred[i][0] - truth[j][0]) for i, j, _ in matches]; end_err = [abs(pred[i][1] - truth[j][1]) for i, j, _ in matches]
    return {"true_positives": tp, "false_positives": fp, "false_negatives": fn, "precision": prec, "recall": rec, "f1": f1,
            "mean_abs_start_error_s": float(np.mean(start_err)) if start_err else None,
            "mean_abs_end_error_s": float(np.mean(end_err)) if end_err else None,
            "false_alarms_per_minute": fp / (duration_s / 60.0) if duration_s > 0 else None,
            "matches": [{"predicted_index": i, "truth_index": j, "iou": v} for i, j, v in matches],
            "matching": f"greedy one-to-one, IoU >= {min_iou}", "n_predicted": len(pred), "n_truth": len(truth)}
