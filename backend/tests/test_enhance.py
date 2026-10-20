import numpy as np
import pytest
from app.processing import enhance as en, vad, voice as vc
from app.processing.fft_analysis import single_sided_spectrum
from synth import speech_like, speech_like_realistic, noise, tone

FS = 16000
TRUTH = [(0.5, 2.0), (2.7, 4.2), (4.9, 6.4), (7.1, 8.6)]          # speech-like segments in scene()

def scene(amp, seed=0):
    segs = []
    for i in range(4): segs += [speech_like(FS, 1.5, seed + i), np.zeros(int(0.7 * FS))]
    clean = np.concatenate([np.zeros(FS // 2)] + segs)
    return clean, clean + noise(clean.size, seed, amp)

def snr(c, y): return 10 * np.log10(np.sum(c ** 2) / np.sum((y[:c.size] - c) ** 2))

# ---------------------------------------------------------------- VAD
def test_vad_finds_known_speech_intervals_at_moderate_snr():
    clean, noisy = scene(0.02)
    v = vad.detect_speech(noisy, FS)
    assert len(v["segments"]) == 4
    for s, (a, b) in zip(v["segments"], TRUTH):
        assert abs(s["start_s"] - a) < 0.15 and abs(s["end_s"] - b) < 0.15, (s, a, b)

def test_vad_still_works_at_5db_input_snr():
    _, noisy = scene(0.05)
    assert len(vad.detect_speech(noisy, FS)["segments"]) == 4

def test_vad_rejects_silence_and_white_noise():
    assert vad.detect_speech(np.zeros(FS * 3), FS)["speech_fraction"] == 0
    assert vad.detect_speech(noise(FS * 5, 3, 0.1), FS)["speech_fraction"] < 0.02

def test_vad_misses_speech_at_very_low_snr_documented_limit():
    _, noisy = scene(0.2)                      # about -7 dB input SNR
    assert vad.detect_speech(noisy, FS)["speech_fraction"] < 0.1

def test_vad_flags_steady_periodic_sound_as_speechlike_documented_limit():
    """A loud sustained 120 Hz tone with a harmonic is periodic, so the rule-based VAD calls it speech-like.
    The VAD cannot separate speech from music/hum - this test documents that limitation."""
    t = np.arange(FS * 3) / FS
    x = 0.3 * np.sin(2 * np.pi * 120 * t) + 0.2 * np.sin(2 * np.pi * 240 * t) + noise(t.size, 1, 0.002)
    x[:FS // 2] *= 0.001                                 # a quiet start so a floor exists
    assert vad.detect_speech(x, FS)["speech_fraction"] > 0.5

def test_pitch_profile_of_reference_and_consistency():
    ref = speech_like(FS, 3.0)
    p = vad.speaker_f0_profile(ref, FS)
    assert 100 < p["f0_p05"] < 125 and 125 < p["f0_p95"] < 160            # synthetic glide 110 -> 140 Hz
    with pytest.raises(ValueError): vad.speaker_f0_profile(noise(FS, 1, 0.1), FS)

# ---------------------------------------------------------------- Wiener tracking
@pytest.mark.parametrize("case", [(0.02, 1.5), (0.05, 4.0), (0.1, 5.0)])
def test_wiener_improves_snr_vs_clean_reference_without_noise_only_profile(case):
    amp, min_gain = case
    clean, noisy = scene(amp)
    y = en.spectral_wiener(noisy, FS, 0.7, 18)["y"]
    assert y.shape == noisy.shape and np.all(np.isfinite(y))
    assert snr(clean, y) - snr(clean, noisy) >= min_gain, (snr(clean, noisy), snr(clean, y))

def test_wiener_barely_changes_clean_speech():
    sp = speech_like(FS, 3.0); x = sp + noise(sp.size, 5, 1e-4)
    y = en.spectral_wiener(x, FS, 0.5, 15)["y"]
    sx, sy = single_sided_spectrum(x, FS), single_sided_spectrum(y, FS)
    m = (sx["freqs_hz"] > 300) & (sx["freqs_hz"] < 3000)
    assert abs(10 * np.log10(sy["power"][m].sum() / sx["power"][m].sum())) < 1.5

def test_wiener_reduces_stationary_hum_and_whistle_but_not_speech():
    clean, _ = scene(0.0)
    t = np.arange(clean.size) / FS
    interf = 0.04 * np.sin(2 * np.pi * 60 * t) + 0.03 * np.sin(2 * np.pi * 3100 * t)
    noisy = clean + interf + noise(clean.size, 2, 0.01)
    y = en.spectral_wiener(noisy, FS, 0.8, 24)["y"]
    assert snr(clean, y) > snr(clean, noisy) + 3.0

def test_wiener_input_validation_and_short_signal():
    with pytest.raises(ValueError): en.spectral_wiener(noise(1000), FS)
    with pytest.raises(ValueError): en.spectral_wiener(noise(FS * 2), FS, strength=1.5)
    with pytest.raises(ValueError): en.spectral_wiener(noise(FS * 2), FS, frame_length=1000)
    assert np.all(np.isfinite(en.spectral_wiener(np.zeros(FS * 2), FS)["y"]))

# ---------------------------------------------------------------- speech gate and peak guard
def test_vad_attenuate_only_outside_speech_and_is_smooth():
    clean, noisy = scene(0.02); v = vad.detect_speech(noisy, FS)
    x = np.atleast_2d(noisy); r = en.vad_attenuate(x, FS, v, 12.0)["y"][0]
    g = r[FS * 3 - 0: FS * 3] if False else None
    inside = (slice(int(0.8 * FS), int(1.8 * FS)))
    gap = slice(int(2.3 * FS), int(2.55 * FS))
    assert np.allclose(r[inside], noisy[inside], atol=1e-9)                              # speech untouched
    assert abs(np.sqrt(np.mean(r[gap] ** 2)) / np.sqrt(np.mean(noisy[gap] ** 2)) - 10 ** (-12 / 20)) < 0.02
    assert np.array_equal(en.vad_attenuate(x, FS, v, 0.0)["y"][0], noisy)               # 0 dB = bypass
    with pytest.raises(ValueError): en.vad_attenuate(x, FS, v, 50)

def test_peak_guard_identity_below_ceiling_and_exact_gain_above():
    x = 0.5 * np.ones((1, 10)); y, g = en.peak_guard(x, -0.5)
    assert y is x and g == 0.0
    x2 = 1.2 * np.ones((2, 10)); y2, g2 = en.peak_guard(x2, -0.5)
    assert abs(np.max(np.abs(y2)) - 10 ** (-0.5 / 20)) < 1e-12 and g2 < 0

def test_pipeline_peak_guard_prevents_filter_overshoot_clipping_and_is_logged():
    t = np.arange(FS * 2) / FS
    sq = 0.99 * np.sign(np.sin(2 * np.pi * 2 * t + 0.1))               # 2 Hz near-full-scale square wave: each edge is a 1.98 step
    raw = vc.run_voice_pipeline(sq, FS, "manual", {"rumble": {"enabled": True, "cutoff_hz": 80.0}, "peak_guard": {"enabled": False}})
    assert np.max(np.abs(raw["output"])) > 1.0                           # the overshoot is real (the bug seen on the uploaded file)
    r = vc.run_voice_pipeline(sq, FS, "manual", {"rumble": {"enabled": True, "cutoff_hz": 80.0}})
    assert np.max(np.abs(r["output"])) <= 10 ** (-0.5 / 20) + 1e-9 and r["quality"]["clipped_samples"] == 0
    assert any(h["stage"] == "peak_guard" and h["params"]["applied_gain_db"] < 0 for h in r["history"])

def test_lecture_speech_preset_runs_improves_snr_and_logs_stages():
    segs = []
    for i in range(4): segs += [speech_like_realistic(FS, 1.5, i), np.zeros(int(0.7 * FS))]
    clean = np.concatenate([np.zeros(FS // 2)] + segs); noisy = clean + noise(clean.size, 0, 0.03)
    r = vc.run_voice_pipeline(noisy, FS, "lecture_speech")
    y = r["output"][0]
    assert r["quality"]["ok"] and [h["stage"] for h in r["history"] if h["stage"] != "peak_guard"] == \
        ["dc_removal", "rumble_highpass", "noise_reduction", "speech_gate"]
    assert snr(clean, y) > snr(clean, noisy) + 2.0

def test_speech_gate_skips_with_warning_when_no_speech_found():
    r = vc.run_voice_pipeline(noise(FS * 4, 1, 0.1), FS, "lecture_speech")
    assert any(h["stage"] == "speech_gate_skipped" for h in r["history"]) and any("Speech gate skipped" in w for w in r["warnings"])

def test_unknown_noise_method_rejected():
    with pytest.raises(ValueError):
        vc.run_voice_pipeline(noise(FS * 3, 1, 0.1), FS, "manual", {"noise_reduction": {"enabled": True, "method": "ml"}})

def test_stereo_lecture_preset_preserves_channels():
    clean, noisy = scene(0.03); x = np.vstack([noisy, 0.8 * noisy])
    r = vc.run_voice_pipeline(x, FS, "lecture_speech")
    assert r["output"].shape == x.shape and np.all(np.isfinite(r["output"]))
