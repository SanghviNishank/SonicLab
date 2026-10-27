"""Milestone 5: RoadSonic on deterministic SYNTHETIC fixtures (ground truth known by construction).

These are regression tests of observed behaviour of the rule-based detector; they do not estimate real-world accuracy.
Tolerances: event boundaries within 0.15 s (observed mean error 0.04 s; frame 64 ms, hop 16 ms).
"""
import time
import numpy as np
import pytest

import fixtures_roadsonic as fr
from app.processing import audio_io
from app.processing.siren_features import extract_features
from app.processing.siren_detector import detect_candidate_sirens, sensitivity_config, evaluate_events

TOL_S = 0.15
FIX = fr.build()
POS = {k: v for k, v in FIX.items() if v["expect"] == "event"}
NEG = {k: v for k, v in FIX.items() if v["expect"] == "none"}


def events(x, level="medium"):
    return detect_candidate_sirens(extract_features(x, fr.FS), sensitivity_config(level))["events"]


def test_fixtures_are_deterministic_and_documented():
    a, b = fr.build(), fr.build()
    assert list(a) == list(b) and all(fr.sha256(a[k]["x"]) == fr.sha256(b[k]["x"]) for k in a)
    assert len(POS) == 10 and len(NEG) == 12
    for k, v in FIX.items():
        assert v["x"].shape == (fr.N,) and np.isfinite(v["x"]).all()
        assert all(0 <= s < e <= fr.DUR for s, e in v["truth"])
        assert v["category"] and isinstance(v["params"], dict)


def test_wav_files_roundtrip_through_the_real_decoder(tmp_path):
    man = fr.write_wavs(tmp_path)
    assert all(m["synthetic"] for m in man["fixtures"].values())
    for name in ("wail_clean", "silence", "pulsed_beeper_2.9k"):
        d = audio_io.decode_audio((tmp_path / man["fixtures"][name]["file"]).read_bytes())
        assert d["sample_rate"] == fr.FS and d["samples"].shape == (1, fr.N)
        assert np.array_equal(d["samples"][0].astype(np.float32), FIX[name]["x"].astype(np.float32))


@pytest.mark.parametrize("name", sorted(POS))
def test_positive_fixtures_give_the_right_number_of_events_with_accurate_boundaries_at_medium(name):
    f = FIX[name]; ev = events(f["x"])
    assert len(ev) == len(f["truth"]), f"{name}: {len(ev)} events for {len(f['truth'])} true"
    for e, (s, t) in zip(ev, f["truth"]):
        assert abs(e["start_s"] - s) <= TOL_S and abs(e["end_s"] - t) <= TOL_S
    r = evaluate_events(ev, f["truth"], fr.DUR)
    assert r["true_positives"] == len(f["truth"]) and r["false_positives"] == 0


@pytest.mark.parametrize("name", sorted(NEG))
@pytest.mark.parametrize("level", ["low", "medium"])
def test_negative_fixtures_produce_no_events_at_low_and_medium(name, level):
    assert events(NEG[name]["x"], level) == []


def test_at_high_sensitivity_the_only_false_alarm_is_the_slow_glide_documented_limitation():
    fa = sorted(k for k, v in NEG.items() if events(v["x"], "high"))
    assert fa == ["slow_glide_tone"]


def test_detection_is_amplitude_invariant_over_a_50x_range():
    ref = events(FIX["wail_volume_1.0"]["x"])
    for k in ("wail_volume_0.1", "wail_volume_0.02"):
        ev = events(FIX[k]["x"])
        assert len(ev) == len(ref) == 1 and abs(ev[0]["start_s"] - ref[0]["start_s"]) < 0.05 and abs(ev[0]["end_s"] - ref[0]["end_s"]) < 0.05


def test_noise_robustness_boundary_is_documented_siren_found_down_to_about_minus_one_db_snr_at_medium():
    from synth import siren, noise
    sirn = fr.place(siren(fr.FS, 4.0, 600, 1400, 0.5, 0.5), 3.0)
    found = {s: len(events(sirn + noise(fr.N, 21, s))) for s in (0.2, 0.4, 0.7, 1.0)}      # SNR 4.9, -1.1, -5.9, -9.0 dB
    assert found[0.2] == 1 and found[0.4] == 1 and found[0.7] == 0 and found[1.0] == 0     # misses below ~-3 dB are a limitation, not a bug


def test_event_schema_labels_and_score_semantics():
    e = events(FIX["wail_clean"]["x"])[0]
    for key in ("start_s", "end_s", "duration_s", "method", "label", "features", "rules", "thresholds", "trajectory",
                "evidence_terms", "heuristic_score", "score_definition", "explanation"):
        assert key in e
    assert e["label"] == "candidate siren event" and "not a probability" in e["score_definition"]
    assert 0.0 <= e["heuristic_score"] <= 1.0 and e["duration_s"] == pytest.approx(e["end_s"] - e["start_s"])
    assert all(e["rules"].values())                              # every rule passed for a reported event


def test_detection_time_on_a_10_second_clip_is_well_below_real_time():
    x = FIX["wail_traffic_noise"]["x"]; t0 = time.perf_counter(); events(x); dt = time.perf_counter() - t0
    assert dt < 5.0              # generous bound for slow CI machines; measured value is in docs/roadsonic_evaluation.md
