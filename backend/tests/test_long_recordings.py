"""Regression tests: recordings longer than the single-FFT limit (2**22 samples, ~95 s at 44.1 kHz).

Defect (found by running a 277 s upload through the API): single_sided_spectrum() defaulted n_fft to the record length and
rejected anything above MAX_NFFT, so /analyze, /filter and /voice all returned HTTP 422 'n_fft exceeds safe maximum' for
any recording longer than ~95 s, although the documented duration limit is 300 s. Fix: segment-averaged spectrum.
"""
import io
import numpy as np
import soundfile as sf
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.processing import fft_analysis as fa

c = TestClient(app)


def _tone(fs, seconds, freqs_amps, seed=0, noise=0.0):
    t = np.arange(int(fs * seconds)) / fs
    x = sum(a * np.sin(2 * np.pi * f * t) for f, a in freqs_amps)
    if noise:
        x = x + noise * np.random.default_rng(seed).standard_normal(t.size)
    return x


# ---------------------------------------------------------------- unit level (small MAX_NFFT so the test is fast)
@pytest.fixture
def small_limit(monkeypatch):
    monkeypatch.setattr(fa, "MAX_NFFT", 2 ** 14)
    monkeypatch.setattr(fa, "DEFAULT_SEGMENT", 2 ** 13)


def test_long_record_uses_segment_average_and_keeps_tone_frequency_and_amplitude(small_limit):
    fs = 8000
    x = _tone(fs, 12.0, [(1000.0, 0.5), (2500.0, 0.25)], noise=0.01)       # 96000 samples > 2**14
    assert x.size > fa.MAX_NFFT
    sp = fa.single_sided_spectrum(x, fs, "hann")
    assert sp["method"] == "segment_averaged" and sp["n_segments"] > 3
    assert sp["n_fft"] == 2 ** 13 and abs(sp["bin_spacing_hz"] - fs / 2 ** 13) < 1e-12
    pk = fa.find_spectral_peaks(sp["freqs_hz"], sp["amplitude"])
    assert abs(pk[0]["frequency_hz"] - 1000.0) < 0.2 and abs(pk[0]["amplitude"] - 0.5) < 0.5 * 0.02     # within 2 %
    assert abs(pk[1]["frequency_hz"] - 2500.0) < 0.2 and abs(pk[1]["amplitude"] - 0.25) < 0.25 * 0.02


def test_every_sample_contributes_to_the_average(small_limit):
    """A tone present ONLY in the last 1/6 of the record must still appear (last frame is aligned to the end)."""
    fs, n = 8000, 6 * 2 ** 13 + 777                                         # length not a multiple of the hop
    x = np.zeros(n)
    tail = np.arange(2 ** 13)
    x[-tail.size:] = 0.8 * np.sin(2 * np.pi * 1500 * tail / fs)
    sp = fa.single_sided_spectrum(x, fs, "hann")
    k = int(np.argmax(sp["amplitude"]))
    assert sp["method"] == "segment_averaged" and abs(sp["freqs_hz"][k] - 1500) < 2 * sp["bin_spacing_hz"] and sp["amplitude"][k] > 0.05


def test_short_records_are_unchanged_full_record(small_limit):
    fs = 8000
    x = _tone(fs, 1.0, [(1000.0, 0.5)])                                      # 8000 samples < 2**14
    sp = fa.single_sided_spectrum(x, fs, "hann")
    assert sp["method"] == "full_record" and sp["n_fft"] == x.size and sp["n_segments"] == 1
    pk = fa.find_spectral_peaks(sp["freqs_hz"], sp["amplitude"])[0]
    assert abs(pk["frequency_hz"] - 1000.0) < 0.05 and abs(pk["amplitude"] - 0.5) < 0.5 * 0.01


def test_explicit_n_fft_smaller_than_short_record_is_still_rejected(small_limit):
    with pytest.raises(ValueError, match="no silent truncation"):
        fa.single_sided_spectrum(np.zeros(5000), 8000, "hann", 4096)


def test_long_record_rejects_bad_segment_length(small_limit):
    with pytest.raises(ValueError, match="segment length"):
        fa.single_sided_spectrum(np.zeros(fa.MAX_NFFT + 10), 8000, "hann", fa.MAX_NFFT * 2)


# ---------------------------------------------------------------- API level with REAL limits (100 s at 44.1 kHz = 4.41 M samples)
def test_api_analyze_and_filter_work_beyond_95_seconds():
    fs = 44100
    x = _tone(fs, 100.0, [(1000.0, 0.4), (6000.0, 0.2)])
    assert x.size > 2 ** 22
    buf = io.BytesIO(); sf.write(buf, x, fs, format="WAV", subtype="PCM_16")
    up = c.post("/api/v1/audio/upload", files={"file": ("long.wav", buf.getvalue(), "audio/wav")})
    assert up.status_code == 200, up.text
    aid = up.json()["metadata"]["audio_id"]

    an = c.post(f"/api/v1/clearvoice/{aid}/analyze", json={})
    assert an.status_code == 200, an.text
    sp = an.json()["spectrum"]
    assert sp["method"] == "segment_averaged" and sp["method_note"]
    assert abs(sp["peaks"][0]["frequency_hz"] - 1000.0) < 0.2 and abs(sp["peaks"][0]["amplitude"] - 0.4) < 0.4 * 0.03

    r = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "order": 6, "cutoff_hz": [3000], "method": "zero_phase"})
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["spectrum_filtered"]["method"] == "segment_averaged"
    y, fs2 = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{j['job_id']}/download").content), dtype="float64")
    assert fs2 == fs and y.size == x.size                                    # length and rate preserved exactly
    amp = lambda sig, f: 2 * np.abs(np.fft.rfft(sig[fs * 10: fs * 14] * np.hanning(fs * 4))[int(f * 4)]).max() / np.hanning(fs * 4).sum()
    assert abs(amp(y, 1000) / amp(x, 1000) - 1) < 0.01                       # passband kept
    assert amp(y, 6000) / amp(x, 6000) < 10 ** (-60 / 20)                    # stopband >= 60 dB down
