"""Milestone 3 regression tests: ClearVoice DSP validated against signals with known ground truth."""
import numpy as np
import pytest
from scipy import signal

from app.processing import filters as fl, fft_analysis as fa, voice as vc
from synth import tone, noise, speech_like_realistic

FS = 16000


# ---- spectral peaks -------------------------------------------------------------------------------------------
def test_dc_offset_is_not_reported_as_a_spectral_peak():
    """Defect reproduced before the fix: x = 0.5 + 0.1 sin(2 pi 500 t) gave a spurious 0.5 Hz peak with amplitude 1.76."""
    sp = fa.single_sided_spectrum(0.5 + tone(500, FS, 1.0, 0.1), FS, "hann")
    peaks = fa.find_spectral_peaks(sp["freqs_hz"], sp["amplitude"], 3)
    assert len(peaks) == 1
    assert peaks[0]["frequency_hz"] == pytest.approx(500.0, abs=0.05)
    assert peaks[0]["amplitude"] == pytest.approx(0.1, rel=0.01)


def test_peak_amplitude_and_frequency_error_bounds_for_off_bin_tones():
    """Hann scalloping loss is up to 1.42 dB; the old estimate was still +0.32 dB high. Bound after the fix: 0.1 dB."""
    rng = np.random.default_rng(0)
    for _ in range(100):
        f0, a, n = rng.uniform(200, 7000), rng.uniform(0.1, 0.9), int(rng.integers(8000, 20000))
        sp = fa.single_sided_spectrum(tone(f0, FS, n / FS, a), FS)
        pk = fa.find_spectral_peaks(sp["freqs_hz"], sp["amplitude"], 1)[0]
        assert abs(20 * np.log10(pk["amplitude"] / a)) < 0.1
        assert abs(pk["frequency_hz"] - f0) < 0.05 * 2 * sp["bin_spacing_hz"] + 0.02


def test_silence_has_no_peaks():
    sp = fa.single_sided_spectrum(np.zeros(4096), FS)
    assert fa.find_spectral_peaks(sp["freqs_hz"], sp["amplitude"]) == []


# ---- STFT / ISTFT reconstruction (the pipeline's own parameters) -------------------------------------------------
@pytest.mark.parametrize("n", [48000, 47999, 48001, 16384])
def test_stft_istft_identity_preserves_samples_and_length(n):
    x = speech_like_realistic(FS, n / FS, 1)[:n]
    L, hop = 2048, 512
    _, _, Z = signal.stft(x, fs=FS, window="hann", nperseg=L, noverlap=L - hop, boundary="zeros", padded=True)
    _, y = signal.istft(Z, fs=FS, window="hann", nperseg=L, noverlap=L - hop, boundary=True)
    y = y[: x.size]
    assert y.size == x.size                      # no samples lost (reference ZIP lost 256 and had 1.5x gain)
    assert np.max(np.abs(y - x)) < 1e-9


# ---- filters: measured attenuation must match the designed response --------------------------------------------
@pytest.mark.parametrize("ftype,cut,f_in", [
    ("lowpass", [1000], 300), ("lowpass", [1000], 4000),
    ("highpass", [1000], 300), ("highpass", [1000], 4000),
    ("bandpass", [500, 1500], 1000), ("bandpass", [500, 1500], 100),
    ("bandstop", [900, 1100], 1000), ("bandstop", [900, 1100], 3000)])
@pytest.mark.parametrize("method", ["causal", "zero_phase"])
def test_filter_gain_on_tone_matches_designed_response(ftype, cut, f_in, method):
    t = np.arange(FS * 3) / FS
    r = fl.run_filter(np.sin(2 * np.pi * f_in * t), FS, ftype, 4, cut, method)
    y = r["output"][0][FS: -FS]                  # discard transients
    measured_db = 20 * np.log10(np.sqrt(2) * np.sqrt(np.mean(y ** 2)) + 1e-300)
    resp = r["response"]
    expected_db = float(np.interp(f_in, resp["freqs_hz"], resp["magnitude_db"]))
    assert measured_db == pytest.approx(expected_db, abs=0.5) or (measured_db < -60 and expected_db < -60)


def test_filter_rejects_invalid_parameters():
    x = noise(FS)
    for args in [("lowpass", 4, [FS / 2]), ("lowpass", 4, [FS / 2 + 1]), ("lowpass", 0, [100]), ("lowpass", 13, [100]),
                 ("lowpass", 2.5, [100]), ("bandpass", 4, [1500, 500]), ("bandpass", 4, [500]), ("highpass", 4, [-5]),
                 ("highpass", 4, [float("nan")]), ("notch", 4, [100])]:
        with pytest.raises(fl.FilterError):
            fl.run_filter(x, FS, args[0], args[1], args[2], "causal")


@pytest.mark.parametrize("fs", [8000, 16000, 48000])
def test_near_nyquist_cutoff_is_stable_and_finite(fs):
    x = np.random.default_rng(1).standard_normal(fs)
    for ftype in ("lowpass", "highpass"):
        sos = fl.design_filter(ftype, 12, [fs / 2 * 0.999], fs)
        assert np.all(np.abs(np.concatenate([np.roots(s[3:]) for s in sos])) < 1.0)   # all poles inside the unit circle
        assert np.isfinite(fl.apply_filter(x, sos, "causal")).all()


def test_zero_phase_on_too_short_signal_gives_clear_error_and_causal_still_works():
    with pytest.raises(fl.FilterError, match="too short"):
        fl.run_filter(noise(8), FS, "lowpass", 8, [1000], "zero_phase")
    assert fl.run_filter(noise(8), FS, "lowpass", 8, [1000], "causal")["output"].shape == (1, 8)


def test_filter_silence_stays_silent_and_stereo_channels_are_independent():
    assert np.all(fl.run_filter(np.zeros(FS), FS, "bandpass", 4, [300, 3000], "zero_phase")["output"] == 0)
    t = np.arange(FS) / FS
    st = np.stack([np.sin(2 * np.pi * 200 * t), np.sin(2 * np.pi * 3000 * t)])
    y = fl.run_filter(st, FS, "lowpass", 6, [1000], "zero_phase")["output"]
    assert y.shape == st.shape
    assert np.sqrt(np.mean(y[0, 2000:-2000] ** 2)) > 0.69 and np.sqrt(np.mean(y[1, 2000:-2000] ** 2)) < 0.01


# ---- enhancement pipeline: structural guarantees --------------------------------------------------------------
def test_voice_pipeline_keeps_length_and_does_not_return_the_input_unchanged():
    clean = speech_like_realistic(FS, 4.0, 0)
    clean = clean / np.max(np.abs(clean)) * 0.5
    x = clean + noise(clean.size, 3, 0.05)
    r = vc.run_voice_pipeline(x, FS, "lecture_speech")
    y = r["y"] if "y" in r else r["output"]
    y = np.asarray(y).ravel()
    assert y.size == x.size and np.isfinite(y).all()
    assert np.max(np.abs(y - x)) > 1e-3
