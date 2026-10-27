"""Reproducible RoadSonic evaluation on SYNTHETIC fixtures (ground truth known by construction).

    python scripts/roadsonic_evaluate.py [--out-dir build/roadsonic_fixtures] [--markdown docs/roadsonic_evaluation.md]

Writes the fixture WAV files + manifest.json, decodes them through the project's real decoder (audio_io.decode_audio),
runs feature extraction + the rule-based detector at three sensitivities and reports event-level precision/recall/F1,
boundary errors, false alarms and measured processing time. Synthetic results do NOT estimate real-world accuracy.
"""
import argparse, json, platform, statistics, sys, time
from pathlib import Path
import numpy as np, scipy
ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend"), str(ROOT / "backend" / "tests")]
import fixtures_roadsonic as fr
from synth import siren, noise
from app.processing import audio_io
from app.processing.siren_features import extract_features
from app.processing.siren_detector import detect_candidate_sirens, sensitivity_config, evaluate_events

LEVELS = ("low", "medium", "high")


def run(x, fs, lvl):
    t0 = time.perf_counter(); feat = extract_features(x, fs); t1 = time.perf_counter()
    ev = detect_candidate_sirens(feat, sensitivity_config(lvl))["events"]; t2 = time.perf_counter()
    return ev, t1 - t0, t2 - t1


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--out-dir", default=str(ROOT / "build" / "roadsonic_fixtures"))
    ap.add_argument("--markdown"); ap.add_argument("--json"); a = ap.parse_args()
    man = fr.write_wavs(Path(a.out_dir))
    rows, timing = [], []
    for name, meta in man["fixtures"].items():
        d = audio_io.decode_audio((Path(a.out_dir) / meta["file"]).read_bytes())
        x = d["samples"].mean(axis=0); fs = d["sample_rate"]; truth = [tuple(t) for t in meta["truth_events_s"]]
        for lvl in LEVELS:
            ev, tf, td = run(x, fs, lvl); timing.append((tf, td))
            ev_res = evaluate_events(ev, truth, len(x) / fs) if (truth or ev) else None
            rows.append({"fixture": name, "category": meta["category"], "sensitivity": lvl, "truth": truth,
                         "events": [(round(e["start_s"], 3), round(e["end_s"], 3)) for e in ev], "eval": ev_res})
    agg = {}
    for lvl in LEVELS:
        R = [r for r in rows if r["sensitivity"] == lvl]
        tp = sum(r["eval"]["true_positives"] for r in R if r["eval"]); fp = sum(r["eval"]["false_positives"] for r in R if r["eval"])
        fn = sum(r["eval"]["false_negatives"] for r in R if r["eval"])
        neg = [r for r in R if not r["truth"]]; se = [r["eval"]["mean_abs_start_error_s"] for r in R if r["eval"] and r["eval"]["mean_abs_start_error_s"] is not None]
        ee = [r["eval"]["mean_abs_end_error_s"] for r in R if r["eval"] and r["eval"]["mean_abs_end_error_s"] is not None]
        prec = tp / (tp + fp) if tp + fp else None; rec = tp / (tp + fn) if tp + fn else None
        agg[lvl] = {"TP": tp, "FP": fp, "FN": fn, "precision": prec, "recall": rec,
                    "f1": (2 * prec * rec / (prec + rec)) if prec and rec else None,
                    "negative_fixtures": len(neg), "negative_fixtures_with_false_alarm": sum(1 for r in neg if r["events"]),
                    "mean_abs_start_error_s": float(np.mean(se)) if se else None, "mean_abs_end_error_s": float(np.mean(ee)) if ee else None,
                    "false_alarms_per_minute": fp / (len(R) * fr.DUR / 60.0)}
    # SNR sweep: wail (amp 0.5 -> power 0.125) in white noise of sigma s; SNR measured during the siren
    sweep = []
    for sig in (0.05, 0.1, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0):
        x = fr.place(siren(fr.FS, 4.0, 600, 1400, 0.5, 0.5), 3.0) + noise(fr.N, 21, sig)
        row = {"noise_sigma": sig, "snr_db": float(10 * np.log10(0.125 / sig ** 2))}
        for lvl in LEVELS:
            ev = run(x, fr.FS, lvl)[0]; r = evaluate_events(ev, [(3.0, 7.0)], fr.DUR)
            row[lvl] = f"TP{r['true_positives']}/FP{r['false_positives']}"
        sweep.append(row)
    tf = statistics.median(t[0] for t in timing); td = statistics.median(t[1] for t in timing)
    env = {"python": platform.python_version(), "numpy": np.__version__, "scipy": scipy.__version__, "machine": platform.processor() or platform.machine(),
           "note": "timings measured on the machine that ran this script; they are not Intel i3 measurements unless run there"}
    out = {"environment": env, "aggregate": agg, "snr_sweep": sweep, "median_feature_s": tf, "median_detect_s": td,
           "audio_s_per_fixture": fr.DUR, "rows": rows}
    if a.json: Path(a.json).write_text(json.dumps(out, indent=1, default=float))
    f = lambda v: "n/a" if v is None else f"{v:.3f}"
    md = ["# RoadSonic evaluation on synthetic fixtures", "",
          "**Scope.** 22 deterministic synthetic fixtures (fixed seeds, `backend/tests/fixtures_roadsonic.py`), ground truth known by construction. "
          "Sirens are frequency-modulated sinusoids, not recordings of real emergency vehicles. These numbers show the detector's behaviour on these signals only; "
          "they are **not** an estimate of real-world accuracy. Event match rule: IoU >= 0.3.", "",
          f"Environment: Python {env['python']}, NumPy {env['numpy']}, SciPy {env['scipy']}, {env['machine']}. Regenerate with `python scripts/roadsonic_evaluate.py --markdown docs/roadsonic_evaluation.md`.", "",
          "## Aggregate (pooled over all fixtures)", "", "| sensitivity | TP | FP | FN | precision | recall | F1 | negative fixtures with a false alarm | mean abs start err (s) | mean abs end err (s) |", "|---|---|---|---|---|---|---|---|---|---|"]
    for lvl in LEVELS:
        g = agg[lvl]; md.append(f"| {lvl} | {g['TP']} | {g['FP']} | {g['FN']} | {f(g['precision'])} | {f(g['recall'])} | {f(g['f1'])} | {g['negative_fixtures_with_false_alarm']}/{g['negative_fixtures']} | {f(g['mean_abs_start_error_s'])} | {f(g['mean_abs_end_error_s'])} |")
    md += ["", "## Per fixture (events as start-end seconds)", "", "| fixture | category | truth | low | medium | high |", "|---|---|---|---|---|---|"]
    for name in man["fixtures"]:
        R = {r["sensitivity"]: r for r in rows if r["fixture"] == name}; r0 = R["low"]
        cell = lambda r: ", ".join(f"{s:.2f}-{e:.2f}" for s, e in r["events"]) or "none"
        md.append(f"| {name} | {r0['category']} | {', '.join(f'{s:g}-{e:g}' for s, e in r0['truth']) or 'none'} | {cell(R['low'])} | {cell(R['medium'])} | {cell(R['high'])} |")
    md += ["", "## Robustness to white noise (wail amplitude 0.5, siren at 3-7 s; SNR measured during the siren)", "", "| noise sigma | SNR (dB) | low | medium | high |", "|---|---|---|---|---|"]
    md += [f"| {r['noise_sigma']} | {r['snr_db']:.1f} | {r['low']} | {r['medium']} | {r['high']} |" for r in sweep]
    md += ["", f"## Processing time ({fr.DUR:.0f} s clips, 16 kHz)", "", f"Median feature extraction {tf * 1000:.0f} ms, median detection {td * 1000:.1f} ms per clip on this machine (see environment above).", "",
           "## Known limitations", "", "- Synthetic only; no real traffic, siren or speech recordings were evaluated.", "- A slow 500-1500 Hz glide is flagged at high sensitivity (false alarm); weak or masked sirens are missed (see SNR sweep).",
           "- Optimistic by construction: these fixtures resemble the synthetic signals used earlier to choose the thresholds (docs/roadsonic_benchmark_output.txt), so a perfect medium-sensitivity score is not evidence of generalisation.", "- Scores are heuristic, not probabilities."]
    if a.markdown: Path(a.markdown).write_text("\n".join(md) + "\n")
    print("\n".join(md))


if __name__ == "__main__":
    main()
