import numpy as np
import pytest
from app.processing.voice import (run_voice_pipeline, spectral_gate, resolve_config, PRESETS, quality_checks)
from app.processing.fft_analysis import single_sided_spectrum
from synth import speech_like, noise, tone

FS = 16000

def snr_db(clean, y):
    n = min(clean.size, y.size)
    return 10 * np.log10(np.sum(clean[:n] ** 2) / np.sum((y[:n] - clean[:n]) ** 2))

def scene(seed=1, noise_amp=0.04):
    """0.8 s noise-only lead-in, then 3 s synthetic voiced speech; stationary white noise throughout."""
    sp = speech_like(FS, 3.0)
    clean = np.concatenate([np.zeros(int(0.8 * FS)), sp])
    return clean, clean + noise(clean.size, seed, noise_amp)

def test_spectral_gate_improves_snr_with_clean_reference():
    clean, noisy = scene()
    before = snr_db(clean, noisy)
    out = spectral_gate(noisy, FS, strength=0.7, max_reduction_db=20, noise_segment_s=(0.05, 0.75))
    after = snr_db(clean, out["y"])
    assert out["y"].shape == noisy.shape and np.all(np.isfinite(out["y"]))
    assert after > before + 3.0, (before, after)       # synthetic stationary noise, clean reference available

def test_auto_noise_estimate_also_improves_when_noise_only_frames_exist():
    clean, noisy = scene(2)
    out = spectral_gate(noisy, FS, strength=0.7, max_reduction_db=20)
    assert snr_db(clean, out["y"]) > snr_db(clean, noisy) + 2.0
    assert out["noise_source"].startswith("quietest")

def test_warns_when_no_noise_only_section():
    sp = speech_like(FS, 3.0); noisy = sp + noise(sp.size, 3, 0.04)
    out = spectral_gate(noisy, FS, strength=0.7)
    assert any("noise-only" in w for w in out["warnings"])

def test_speech_band_energy_preserved_on_clean_speech():
    clean = np.concatenate([np.zeros(int(0.8 * FS)), speech_like(FS, 3.0)]) + noise(int(3.8 * FS), 5, 1e-4)
    y = spectral_gate(clean, FS, 0.5, 15, noise_segment_s=(0.05, 0.75))["y"]
    sx = single_sided_spectrum(clean, FS); sy = single_sided_spectrum(y, FS)
    m = (sx["freqs_hz"] > 300) & (sx["freqs_hz"] < 3000)
    ratio = 10 * np.log10(sy["power"][m].sum() / sx["power"][m].sum())
    assert abs(ratio) < 1.0, ratio

def test_gate_validation_and_short_input():
    with pytest.raises(ValueError): spectral_gate(noise(1000), FS)
    with pytest.raises(ValueError): spectral_gate(noise(FS), FS, strength=2)
    with pytest.raises(ValueError): spectral_gate(noise(FS), FS, frame_length=1000)
    with pytest.raises(ValueError): spectral_gate(noise(FS), FS, noise_segment_s=(0.5, 5.0))

def test_silence_input_is_safe():
    out = spectral_gate(np.zeros(FS), FS)
    assert out["bypassed"] and np.all(out["y"] == 0)

def test_pipeline_bypass_returns_identical_and_original_untouched():
    x = np.atleast_2d(speech_like(FS, 1.0)); x0 = x.copy()
    r = run_voice_pipeline(x, FS, "manual")
    assert np.array_equal(r["output"], x0) and np.array_equal(x, x0) and r["history"] == []

def test_all_presets_run_finite_same_shape_and_record_history():
    clean, noisy = scene(); x = np.vstack([noisy, 0.5 * noisy])
    for name in PRESETS:
        r = run_voice_pipeline(x, FS, name)
        assert r["output"].shape == x.shape and np.all(np.isfinite(r["output"])), name
        assert r["quality"]["ok"], (name, r["quality"])
        if name != "manual": assert len(r["history"]) >= 1, name

def test_dc_removed_and_rumble_cut():
    t = np.arange(2 * FS) / FS
    x = 0.3 * np.sin(2 * np.pi * 1000 * t) + 0.2 + 0.2 * np.sin(2 * np.pi * 30 * t)
    r = run_voice_pipeline(x, FS, "low_rumble")["output"][0]
    s = single_sided_spectrum(r[1000:-1000], FS, "hann")
    assert abs(s["amplitude"][0]) < 1e-3                                    # DC gone
    k30 = np.argmin(abs(s["freqs_hz"] - 30)); k1k = np.argmin(abs(s["freqs_hz"] - 1000))
    assert s["amplitude"][k30] < 0.01 and abs(s["amplitude"][k1k] - 0.3) < 0.01

def test_telephone_band_response():
    t = np.arange(2 * FS) / FS
    x = sum(0.2 * np.sin(2 * np.pi * f * t) for f in (100, 1000, 6000))
    y = run_voice_pipeline(x, FS, "telephone_band")["output"][0][1000:-1000]
    s = single_sided_spectrum(y, FS, "hann"); g = lambda f: s["amplitude"][np.argmin(abs(s["freqs_hz"] - f))]
    assert g(1000) > 0.18 and g(100) < 0.02 and g(6000) < 0.02

def test_band_limit_above_nyquist_is_skipped_with_warning_not_silent():
    r = run_voice_pipeline(speech_like(8000, 1.0), 8000, "stationary_hiss", {"noise_reduction": {"enabled": False}})
    assert any("not below Nyquist" in w for w in r["warnings"])
    assert any(h["stage"] == "band_limit_skipped" for h in r["history"])

def test_loudness_gain_never_clips_and_is_reported():
    x = 0.1 * speech_like(FS, 1.0)
    r = run_voice_pipeline(x, FS, "manual", {"loudness": {"enabled": True, "target_peak_dbfs": -1.0}})
    assert abs(np.max(np.abs(r["output"])) - 10 ** (-1 / 20)) < 1e-9
    assert r["history"][-1]["params"]["applied_gain_db"] > 10 and r["quality"]["clipped_samples"] == 0

def test_quality_check_flags_silent_output():
    t = np.arange(FS) / FS; x = 0.5 * np.sin(2 * np.pi * 50 * t)
    r = run_voice_pipeline(x, FS, "manual", {"band_limit": {"enabled": True, "highpass_hz": 3000.0, "order": 8}})
    assert not r["quality"]["ok"] and any("QUALITY CHECK FAILED" in w for w in r["warnings"])

def test_unknown_preset_rejected():
    with pytest.raises(ValueError): resolve_config("nope", None)

def test_causal_method_supported_in_pipeline():
    r = run_voice_pipeline(speech_like(FS, 1.0), FS, "low_rumble", {"method": "causal"})
    assert r["history"][-1]["params"]["method"] == "causal"
