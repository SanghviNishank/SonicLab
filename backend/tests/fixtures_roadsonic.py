"""Deterministic SYNTHETIC RoadSonic fixtures with ground truth.

Everything here is generated with NumPy/SciPy from fixed seeds. None of it is a recording of a real emergency vehicle;
"siren" fixtures are frequency-modulated sinusoids. Results on them say nothing about real-world accuracy.
Used by tests/test_m5_roadsonic.py and scripts/roadsonic_evaluate.py (which also writes the WAV files + manifest.json).
"""
from __future__ import annotations
import hashlib, json
from pathlib import Path
import numpy as np
from scipy.signal import butter, sosfilt
from synth import siren, tone, noise, traffic_like, speech_like

FS = 16000
DUR = 10.0
N = int(FS * DUR)


def place(sig: np.ndarray, start_s: float, n: int = N) -> np.ndarray:
    x = np.zeros(n); i = int(round(start_s * FS)); x[i:i + sig.size] = sig[: n - i]; return x


def fm(freq_track: np.ndarray, amp: float) -> np.ndarray:
    return amp * np.sin(2 * np.pi * np.cumsum(freq_track) / FS)


def engine_noise(n: int = N, seed: int = 11, amp: float = 0.25) -> np.ndarray:
    """Engine/road-like: harmonics of a drifting 35->55 Hz fundamental (up to 440 Hz) + low-passed noise."""
    t = np.arange(n) / FS
    f0 = 35 + 20 * t / (n / FS)
    ph = 2 * np.pi * np.cumsum(f0) / FS
    h = sum((1.0 / k) * np.sin(k * ph + k) for k in range(1, 13))
    rumble = sosfilt(butter(4, 250 / (FS / 2), output="sos"), noise(n, seed, 1.0))
    y = 0.6 * h / np.max(np.abs(h)) + 0.4 * rumble / np.max(np.abs(rumble))
    return amp * y / np.max(np.abs(y))


def hi_lo(dur: float, f_a: float = 500.0, f_b: float = 700.0, period_s: float = 0.6, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(FS * dur)) / FS
    f = np.where((t // period_s) % 2 == 0, f_a, f_b)
    return fm(f, amp)


def beeper(dur: float, f: float = 2900.0, on_s: float = 0.25, period_s: float = 0.5, amp: float = 0.5) -> np.ndarray:
    t = np.arange(int(FS * dur)) / FS
    gate = ((t % period_s) < on_s).astype(float)
    return amp * np.sin(2 * np.pi * f * t) * gate


def melody(dur: float, notes=(262.0, 330.0, 392.0, 523.0), note_s: float = 0.4, amp: float = 0.4) -> np.ndarray:
    t = np.arange(int(FS * dur)) / FS
    f = np.array(notes)[((t // note_s) % len(notes)).astype(int)]
    env = 0.5 * (1 - np.cos(2 * np.pi * (t % note_s) / note_s))          # per-note fade in/out
    return amp * env * np.sin(2 * np.pi * np.cumsum(f) / FS)


def build() -> dict[str, dict]:
    """name -> {x, truth [(start,end)], category, expect, params}. `expect` is 'event' or 'none' (what a good detector does)."""
    wail = siren(FS, 4.0, 600, 1400, 0.5, 0.5)
    F: dict[str, dict] = {}

    def add(name, x, truth, category, params, expect=None):
        F[name] = {"x": x, "truth": truth, "category": category, "params": params, "expect": expect or ("event" if truth else "none")}

    add("wail_clean", place(wail, 3.0), [(3.0, 7.0)], "siren-like", {"f_lo": 600, "f_hi": 1400, "sweeps_per_s": 0.5, "amp": 0.5})
    add("wail_traffic_noise", place(wail, 3.0) + traffic_like(N, FS, 1, 0.25), [(3.0, 7.0)], "siren-like+noise", {"traffic_seed": 1, "traffic_amp": 0.25})
    add("wail_engine_noise", place(wail, 3.0) + engine_noise(), [(3.0, 7.0)], "siren-like+noise", {"engine_seed": 11, "engine_amp": 0.25})
    add("wail_white_noise_0.2", place(wail, 3.0) + noise(N, 2, 0.2), [(3.0, 7.0)], "siren-like+noise", {"white_seed": 2, "white_amp": 0.2})
    add("yelp_3_sweeps_per_s", place(siren(FS, 4.0, 700, 1500, 3.0, 0.5), 3.0), [(3.0, 7.0)], "siren-like", {"sweeps_per_s": 3.0})
    add("hi_lo_two_tone", place(hi_lo(4.0), 3.0), [(3.0, 7.0)], "siren-like", {"f_a": 500, "f_b": 700, "period_s": 0.6})
    add("two_events_with_gap", place(siren(FS, 2.0, amp=0.5), 1.0) + place(siren(FS, 3.0, 800, 1600, 0.7, 0.5), 6.0),
        [(1.0, 3.0), (6.0, 9.0)], "siren-like", {"events": 2})
    for a in (0.02, 0.1, 1.0):
        add(f"wail_volume_{a}", place(siren(FS, 4.0, 600, 1400, 0.5, a), 3.0), [(3.0, 7.0)], "siren-like (volume)", {"amp": a})
    # negatives -----------------------------------------------------------------------------------------------
    add("silence", np.zeros(N), [], "silence", {})
    add("quiet_noise_-50dB", noise(N, 5, 0.003), [], "noise", {"amp": 0.003})
    add("traffic_noise_only", traffic_like(N, FS, 5, 0.4), [], "traffic", {"seed": 5})
    add("engine_road_noise_only", engine_noise(), [], "engine", {"seed": 11})
    add("white_noise_only", noise(N, 6, 0.3), [], "noise", {"seed": 6})
    add("horn_chord_440_550", place(tone(440, FS, 5.0, 0.5) + tone(550, FS, 5.0, 0.4), 2.0) + traffic_like(N, FS, 2, 0.2), [], "horn", {})
    add("horn_vibrato_900", place(fm(900 + 30 * np.sin(2 * np.pi * 6 * np.arange(6 * FS) / FS), 0.5), 2.0), [], "horn", {"vibrato_hz": 6, "dev_hz": 30})
    add("slow_glide_tone", place(fm(np.linspace(500, 1500, 6 * FS), 0.5), 2.0), [], "changing tone", {"from": 500, "to": 1500, "s": 6})
    add("pulsed_beeper_2.9k", place(beeper(6.0), 2.0), [], "alarm", {"f": 2900})
    add("reverse_beeper_1k", place(beeper(6.0, 1000.0, 0.5, 1.0), 2.0), [], "alarm", {"f": 1000})
    add("speech_like_plus_noise", place(speech_like(FS, 6.0), 2.0) + noise(N, 3, 0.02), [], "speech", {"synthetic": True})
    add("melody_stepped_tones", place(melody(6.0), 2.0), [], "music-like", {"notes_hz": [262, 330, 392, 523]})
    return F


def sha256(x: np.ndarray) -> str:
    return hashlib.sha256(np.asarray(x, dtype="<f4").tobytes()).hexdigest()


def write_wavs(out_dir: Path) -> dict:
    """Writes float32 WAV files + manifest.json; returns the manifest."""
    from scipy.io import wavfile
    out_dir.mkdir(parents=True, exist_ok=True)
    man = {"description": "SYNTHETIC RoadSonic fixtures (NumPy/SciPy, fixed seeds). Not real emergency-vehicle recordings.",
           "sample_rate": FS, "duration_s": DUR, "fixtures": {}}
    for name, f in build().items():
        wavfile.write(str(out_dir / f"{name}.wav"), FS, f["x"].astype(np.float32))
        man["fixtures"][name] = {"file": f"{name}.wav", "truth_events_s": f["truth"], "category": f["category"], "expect": f["expect"],
                                 "params": f["params"], "sha256_float32": sha256(f["x"]), "synthetic": True}
    (out_dir / "manifest.json").write_text(json.dumps(man, indent=1))
    return man
