import numpy as np
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
