"""Synthetic RoadSonic benchmark: runs the rule-based detector on generated fixtures with KNOWN ground truth and prints a table.
Synthetic signals only - this says nothing about performance on real recordings.   python scripts/roadsonic_benchmark.py [--json out.json]"""
import argparse, json, sys
from pathlib import Path
import numpy as np
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend")); sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend" / "tests"))
from app.processing.siren_features import extract_features
from app.processing.siren_detector import detect_candidate_sirens, sensitivity_config, evaluate_events
from synth import siren, tone, noise, traffic_like, speech_like

FS = 16000; DUR = 10.0; N = int(FS * DUR)

def place(sig, start):
    x = np.zeros(N); i = int(start * FS); x[i:i + sig.size] = sig; return x

def fixtures():
    out = {}
    s = siren(FS, 4.0, 600, 1400, 0.5, 0.5)
    out["clean siren 600-1400 Hz (truth 3-7 s)"] = (place(s, 3.0), [(3.0, 7.0)])
    for snr_amp in (0.1, 0.25, 0.5):
        out[f"siren + traffic-like noise (noise rms ~{snr_amp * 0.2:.2f}, siren amp 0.5)"] = (place(s, 3.0) + traffic_like(N, FS, 1, snr_amp), [(3.0, 7.0)])
    for amp in (0.2, 0.5):
        out[f"siren + white noise amp {amp}"] = (place(s, 3.0) + noise(N, 2, amp), [(3.0, 7.0)])
    out["weak siren (amp 0.01) + noise 0.2"] = (place(siren(FS, 4.0, amp=0.01), 3.0) + noise(N, 4, 0.2), [(3.0, 7.0)])
    out["narrow-sweep siren 700-1000 Hz"] = (place(siren(FS, 4.0, 700, 1000, 0.5, 0.5), 3.0), [(3.0, 7.0)])
    out["fast 'yelp' siren 700-1500 Hz, 3 sweeps/s"] = (place(siren(FS, 4.0, 700, 1500, 3.0, 0.5), 3.0), [(3.0, 7.0)])
    out["two sirens (1-3 s, 6-9 s)"] = (place(siren(FS, 2.0, amp=0.5), 1.0) + place(siren(FS, 3.0, 800, 1600, 0.7, 0.5), 6.0), [(1.0, 3.0), (6.0, 9.0)])
    out["steady horn chord 440+550 Hz (no siren)"] = (place(tone(440, FS, 5.0, 0.5) + tone(550, FS, 5.0, 0.4), 2.0) + traffic_like(N, FS, 2, 0.2), [])
    out["steady tone 900 Hz (no siren)"] = (place(tone(900, FS, 6.0, 0.5), 2.0), [])
    out["vibrato horn 900 Hz +-30 Hz, 6 Hz (no siren)"] = (place(0.5 * np.sin(2 * np.pi * np.cumsum(900 + 30 * np.sin(2 * np.pi * 6 * np.arange(6 * FS) / FS)) / FS), 2.0), [])
    out["slow glide 500->1500 Hz tone (not a siren)"] = (place(0.5 * np.sin(2 * np.pi * np.cumsum(np.linspace(500, 1500, 6 * FS)) / FS), 2.0), [])
    out["speech-like (synthetic voiced) + noise (no siren)"] = (place(speech_like(FS, 6.0), 2.0) + noise(N, 3, 0.02), [])
    out["traffic-like noise only"] = (traffic_like(N, FS, 5, 0.4), [])
    out["white noise only"] = (noise(N, 6, 0.3), [])
    out["silence"] = (np.zeros(N), [])
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--json"); a = ap.parse_args()
    rows = []
    print(f"{'fixture':62s} {'sens':6s} events  result")
    for name, (x, truth) in fixtures().items():
        feat = extract_features(x, FS)
        for lvl in ("low", "medium", "high"):
            ev = detect_candidate_sirens(feat, sensitivity_config(lvl))["events"]
            r = evaluate_events(ev, truth, DUR) if truth or ev else None
            if truth: res = f"TP {r['true_positives']}/{len(truth)}  FP {r['false_positives']}" + (f"  start err {r['mean_abs_start_error_s']:.2f}s end err {r['mean_abs_end_error_s']:.2f}s" if r["mean_abs_start_error_s"] is not None else "")
            else: res = "no event (correct)" if not ev else f"FALSE ALARM x{len(ev)}"
            print(f"{name:62s} {lvl:6s} {len(ev):3d}     {res}")
            rows.append({"fixture": name, "sensitivity": lvl, "n_events": len(ev), "truth": truth, "events": [(e['start_s'], e['end_s']) for e in ev], "eval": r})
    if a.json: Path(a.json).write_text(json.dumps(rows, indent=1, default=float))

if __name__ == "__main__":
    main()
