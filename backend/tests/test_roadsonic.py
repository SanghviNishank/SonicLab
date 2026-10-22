import numpy as np
import pytest
from app.processing.siren_features import extract_features
from app.processing.siren_detector import detect_candidate_sirens, DetectorConfig
from synth import tone, siren, noise, traffic_like

FS = 16000

def detect(x, cfg=None):
    return detect_candidate_sirens(extract_features(x, FS), cfg)["events"]

def scene(dur=10.0, start=3.0, siren_dur=4.0, snr_gain=0.5, seed=1):
    n = int(FS * dur)
    bg = traffic_like(n, FS, seed, 0.2)
    s = siren(FS, siren_dur, amp=snr_gain)
    i = int(start * FS)
    x = bg.copy(); x[i:i + s.size] += s
    return x

def test_silence_and_noise_give_no_events():
    assert detect(np.zeros(FS * 5)) == []
    assert detect(noise(FS * 5, 2, 0.2)) == []
    assert detect(traffic_like(FS * 8, FS)) == []

def test_clean_siren_detected_with_timestamp_accuracy():
    x = np.concatenate([np.zeros(FS * 2), siren(FS, 4.0), np.zeros(FS * 2)])
    ev = detect(x)
    assert len(ev) == 1
    assert abs(ev[0]["start_s"] - 2.0) < 0.6 and abs(ev[0]["end_s"] - 6.0) < 0.6   # documented tolerance 0.6 s
    assert ev[0]["label"] == "candidate siren event"

def test_siren_in_traffic_noise_and_volume_invariance():
    for gain in (1.0, 0.1, 5.0):
        x = scene() * gain
        ev = detect(x)
        assert len(ev) == 1, gain
        assert abs(ev[0]["start_s"] - 3.0) < 0.8 and abs(ev[0]["end_s"] - 7.0) < 0.8

def test_horn_is_false_positive_challenge_rejected():
    n = FS * 6
    horn = np.zeros(n); horn[FS:5 * FS] = tone(440, FS, 4.0, 0.5) + tone(550, FS, 4.0, 0.4)
    assert detect(horn + traffic_like(n, FS, 3, 0.2)) == []
    assert detect(tone(900, FS, 5.0, 0.5)) == []

def test_distant_siren_buried_in_noise_is_missed_documented():
    ev = detect(noise(FS * 10, 4, 0.2) + np.pad(siren(FS, 4.0, amp=0.01), (3 * FS, 3 * FS)))
    assert ev == []   # known limitation: very low SNR -> missed detection

def test_two_separate_sirens_two_events():
    x = np.concatenate([siren(FS, 3.0), np.zeros(FS * 3), siren(FS, 3.0, 800, 1600, 0.7)])
    ev = detect(x)
    assert len(ev) == 2 and ev[0]["end_s"] < ev[1]["start_s"]

def test_reproducible_and_config_recorded():
    x = scene(); cfg = DetectorConfig(min_f0_range_hz=200)
    a = detect_candidate_sirens(extract_features(x, FS), cfg); b = detect_candidate_sirens(extract_features(x, FS), cfg)
    assert a == b and a["config"]["min_f0_range_hz"] == 200

def test_short_clip_no_crash():
    assert detect(noise(100, 1)) == []


def test_event_times_align_with_spectrogram_axis():
    """Overlay contract: the event interval and the spectrogram time axis share one seconds reference."""
    from app.processing.spectrogram import stft_db
    x = np.concatenate([np.zeros(FS * 2), siren(FS, 4.0), np.zeros(FS * 2)])
    ev = detect(x)[0]
    S = stft_db(x, FS, 1024, 256)
    band = (S["freqs_hz"] >= 600) & (S["freqs_hz"] <= 1400)
    lvl = S["magnitude_db"][band].max(axis=0)
    active = S["times_s"][lvl > -40]
    assert abs(active.min() - 2.0) < 0.15 and abs(active.max() - 6.0) < 0.15       # ground truth 2.0-6.0 s
    assert abs(ev["start_s"] - active.min()) < 0.5 and abs(ev["end_s"] - active.max()) < 0.5

def test_detection_across_sample_rates():
    from app.processing.siren_features import extract_features as ef
    for fs in (8000, 22050, 44100, 48000):
        x = np.concatenate([np.zeros(fs * 2), siren(fs, 4.0), np.zeros(fs * 2)])
        ev = detect_candidate_sirens(ef(x, fs))["events"]
        assert len(ev) == 1, fs
        assert abs(ev[0]["start_s"] - 2.0) < 0.6 and abs(ev[0]["end_s"] - 6.0) < 0.6, fs

def test_stereo_mix_and_antiphase_cancellation_is_documented_limitation():
    s = siren(FS, 4.0); x = np.concatenate([np.zeros(FS), s, np.zeros(FS)])
    mix_same = (x + x) / 2
    assert len(detect(mix_same)) == 1
    assert detect((x + (-x)) / 2) == []          # out-of-phase channels cancel in a mono mix (documented in the UI/API)


def test_trajectory_description_on_known_shapes():
    from app.processing.siren_detector import describe_trajectory
    tt = np.linspace(0, 4, 200)
    assert describe_trajectory(tt, 600 + 200 * tt)["pattern"] == "rising sweep"
    assert describe_trajectory(tt, 1400 - 200 * tt)["pattern"] == "falling sweep"
    d = describe_trajectory(tt, 1000 + 400 * np.sin(2 * np.pi * 0.5 * tt))               # 2 cycles in 4 s
    assert d["pattern"].startswith("oscillating") and d["turning_points"] >= 3
    rate = float(d["pattern"].split("~")[1].split(" ")[0]); assert 0.3 < rate < 0.8
    assert describe_trajectory(tt[:3], np.array([1.0, 2.0, 3.0]))["pattern"] == "too short to describe"

def test_event_has_explanation_trajectory_and_score_definition_from_real_data():
    x = np.concatenate([np.zeros(FS * 2), siren(FS, 4.0), np.zeros(FS * 2)])
    e = detect(x)[0]
    assert e["trajectory"]["pattern"].startswith("oscillating")
    assert "not a confirmed siren" in e["explanation"] and "probability" in e["score_definition"]
    assert abs(e["heuristic_score"] - np.mean(list(e["evidence_terms"].values()))) < 1e-12
    assert 590 < min(e["trajectory"]["freq_hz"]) < 700 and 1300 < max(e["trajectory"]["freq_hz"]) < 1410     # true sweep 600-1400 Hz

def test_timestamps_always_inside_recording_and_ordered():
    for dur_lead in (0.0, 0.2):                    # siren starting at / very near t=0, and ending at the very end
        x = np.concatenate([np.zeros(int(FS * dur_lead)), siren(FS, 3.0)])
        for e in detect(x):
            assert 0.0 <= e["start_s"] < e["end_s"] <= x.size / FS + 1e-9

def test_max_event_duration_splits_long_interval_and_is_recorded():
    x = siren(FS, 8.0)
    ev = detect(x, DetectorConfig(max_event_s=3.0))
    assert len(ev) >= 2 and all(e["duration_s"] <= 3.0 + 1e-6 for e in ev)
    assert all("piece" in e["explanation"] for e in ev) and ev[0]["end_s"] <= ev[1]["start_s"] + 1e-9

def test_merge_gap_controls_whether_two_sirens_merge():
    x = np.concatenate([siren(FS, 3.0), np.zeros(int(0.8 * FS)), siren(FS, 3.0)])
    assert len(detect(x, DetectorConfig(merge_gap_s=0.1))) == 2
    assert len(detect(x, DetectorConfig(merge_gap_s=3.0))) == 1

def test_min_event_duration_discards_short_candidates():
    x = np.concatenate([np.zeros(FS), siren(FS, 1.6), np.zeros(FS)])
    assert len(detect(x, DetectorConfig(min_event_s=0.5))) == 1
    assert detect(x, DetectorConfig(min_event_s=3.0)) == []

def test_sensitivity_presets_trade_misses_for_false_alarms():
    from app.processing.siren_detector import sensitivity_config
    horn_vib = np.concatenate([np.zeros(FS), tone(900, FS, 4.0, 0.5), np.zeros(FS)])
    for lvl in ("low", "medium"):
        assert detect(horn_vib, sensitivity_config(lvl)) == [], lvl                 # steady horn rejected at default and strict
    weak = np.pad(siren(FS, 4.0, 700, 1000, 0.5, 0.5), (FS, FS))                    # narrow 300 Hz sweep
    assert len(detect(weak, sensitivity_config("high"))) >= len(detect(weak, sensitivity_config("low")))

def test_new_features_flatness_and_prominence_on_known_signals():
    f = extract_features(tone(1000, FS, 2.0, 0.5), FS); g = extract_features(noise(FS * 2, 1, 0.1), FS)
    assert np.median(f["flatness"]) < 0.01 and np.median(g["flatness"]) > 0.3
    assert np.median(f["peak_prominence_db"]) > 40 and np.median(g["peak_prominence_db"]) < 15

def test_feature_frame_and_hop_calculations_and_axes():
    f = extract_features(noise(FS * 2, 1, 0.1), FS, frame_ms=64, hop_ms=16)
    L, H = f["meta"]["frame_length"], f["meta"]["hop_length"]
    assert (L, H) == (1024, 256) and f["time_s"].size == 1 + (FS * 2 - L) // H
    assert abs(f["time_s"][0] - (L / 2) / FS) < 1e-12 and abs(f["time_s"][1] - f["time_s"][0] - H / FS) < 1e-12
    assert abs(f["meta"]["duration_s"] - 2.0) < 1e-12

def test_evaluate_events_against_labels():
    from app.processing.siren_detector import evaluate_events
    ev = [{"start_s": 2.1, "end_s": 5.9}, {"start_s": 8.0, "end_s": 9.5}]
    r = evaluate_events(ev, [(2.0, 6.0), (12.0, 14.0)], 20.0)
    assert (r["true_positives"], r["false_positives"], r["false_negatives"]) == (1, 1, 1)
    assert r["precision"] == 0.5 and r["recall"] == 0.5 and abs(r["f1"] - 0.5) < 1e-12
    assert abs(r["mean_abs_start_error_s"] - 0.1) < 1e-9 and abs(r["false_alarms_per_minute"] - 3.0) < 1e-9
    assert evaluate_events([], [], 10.0)["precision"] is None                       # nothing predicted, nothing labelled: undefined, not 100 %
    with pytest.raises(ValueError): evaluate_events([], [(5.0, 4.0)], 10.0)


def _det_level(x, lvl):
    from app.processing.siren_detector import sensitivity_config
    return detect_candidate_sirens(extract_features(x, FS), sensitivity_config(lvl))["events"]

def test_benchmark_sensitivity_tradeoff_slow_glide_false_alarm_only_at_high():
    """From scripts/roadsonic_benchmark.py: a slow 500->1500 Hz tone glide (not a siren) is a false alarm at HIGH sensitivity only."""
    t = np.arange(6 * FS)
    glide = np.zeros(10 * FS); glide[2 * FS:8 * FS] = 0.5 * np.sin(2 * np.pi * np.cumsum(np.linspace(500, 1500, 6 * FS)) / FS)
    assert _det_level(glide, "low") == [] and _det_level(glide, "medium") == []
    assert len(_det_level(glide, "high")) == 1

def test_benchmark_fast_yelp_missed_at_low_sensitivity_found_at_medium():
    x = np.zeros(10 * FS); x[3 * FS:7 * FS] = siren(FS, 4.0, 700, 1500, 3.0, 0.5)
    assert _det_level(x, "low") == []
    ev = _det_level(x, "medium"); assert len(ev) == 1 and abs(ev[0]["start_s"] - 3.0) < 0.3 and abs(ev[0]["end_s"] - 7.0) < 0.3

def test_benchmark_vibrato_horn_and_synthetic_speech_never_flagged():
    from synth import speech_like
    horn = np.zeros(10 * FS); horn[2 * FS:8 * FS] = 0.5 * np.sin(2 * np.pi * np.cumsum(900 + 30 * np.sin(2 * np.pi * 6 * np.arange(6 * FS) / FS)) / FS)
    sp = np.zeros(10 * FS); sp[2 * FS:8 * FS] = speech_like(FS, 6.0); sp += noise(10 * FS, 3, 0.02)
    for lvl in ("low", "medium", "high"):
        assert _det_level(horn, lvl) == [] and _det_level(sp, lvl) == [], lvl

def test_noisy_siren_found_at_medium_missed_at_low_documented():
    x = np.zeros(10 * FS); x[3 * FS:7 * FS] = siren(FS, 4.0, 600, 1400, 0.5, 0.5); x = x + noise(10 * FS, 2, 0.5)
    assert len(_det_level(x, "medium")) == 1 and _det_level(x, "low") == []
