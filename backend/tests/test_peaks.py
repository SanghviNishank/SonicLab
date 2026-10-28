"""Regression: one tone's leakage lobe / a siren plateau must not be reported as several separate spectral peaks.
Found in the UI: a 14 s siren-in-noise recording listed 1396.0, 1396.5, 1397.0, 1397.5 ... Hz as five 'dominant peaks'."""
import numpy as np
import pytest
from app.processing import fft_analysis as fa

FS = 16000


def _peaks(x, window="hann"):
    sp = fa.single_sided_spectrum(x, FS, window)
    return fa.find_spectral_peaks(sp["freqs_hz"], sp["amplitude"], window=window)


@pytest.mark.parametrize("window", ["hann", "rect"])
def test_one_noisy_tone_gives_one_peak(window):
    t = np.arange(FS * 14) / FS
    x = 0.4 * np.sin(2 * np.pi * 1396.7 * t) + 0.05 * np.random.default_rng(3).standard_normal(t.size)
    pk = _peaks(x, window)
    assert len(pk) == 1 and abs(pk[0]["frequency_hz"] - 1396.7) < 0.2 and abs(pk[0]["amplitude"] - 0.4) < (0.02 if window == "hann" else 0.04)   # rect: scalloping makes amplitude less exact (measured 0.023)


def test_two_separate_tones_are_both_reported_strongest_first():
    t = np.arange(FS * 4) / FS
    x = 0.5 * np.sin(2 * np.pi * 440 * t) + 0.25 * np.sin(2 * np.pi * 1000 * t) + 0.01 * np.random.default_rng(1).standard_normal(t.size)
    pk = _peaks(x)
    assert [round(p["frequency_hz"]) for p in pk[:2]] == [440, 1000] and len(pk) == 2


def test_frequency_sweep_plateau_is_not_split_into_fake_peaks_and_never_empty():
    t = np.arange(FS * 6) / FS
    x = 0.5 * np.sin(2 * np.pi * (600 * t + 400 / (2 * np.pi * 0.5) * (1 - np.cos(2 * np.pi * 0.5 * t)))) + 0.05 * np.random.default_rng(2).standard_normal(t.size)
    pk = _peaks(x)
    assert 1 <= len(pk) <= 2                                         # a swept tone has no single frequency; it must not look like five tones
    assert all(500 < p["frequency_hz"] < 1100 for p in pk)


def test_silence_has_no_peaks():
    assert _peaks(np.zeros(FS)) == []
