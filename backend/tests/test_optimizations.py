"""Equivalence tests for the memory/speed optimisations: every optimised routine must reproduce the straightforward reference
implementation (the code that existed before) to numerical precision. If one of these fails, an 'optimisation' changed the audio.
"""
import io
import numpy as np
import pytest
import soundfile as sf
from scipy import signal
from scipy.ndimage import minimum_filter1d

from app.processing import audio_io, enhance as enh, filters as flt, stft_lean, vad, voice as vc


# ---------------------------------------------------------------- lean STFT == scipy STFT
@pytest.mark.parametrize("n,L,hop", [(50000, 2048, 512), (12345, 256, 64), (30001, 1024, 256), (8192, 2048, 512), (2 ** 14 + 1, 512, 128)])
def test_lean_stft_and_istft_match_scipy_exactly(n, L, hop):
    x = np.random.default_rng(n).standard_normal(n)
    _, t, Z = signal.stft(x, fs=16000, window="hann", nperseg=L, noverlap=L - hop, boundary="zeros", padded=True)
    t2, Z2 = stft_lean.stft(x, 16000, L, hop)
    assert Z.shape == Z2.shape and np.allclose(t, t2, atol=1e-12)
    assert np.max(np.abs(Z - Z2)) <= 1e-14 * np.max(np.abs(Z))
    _, y = signal.istft(Z, fs=16000, window="hann", nperseg=L, noverlap=L - hop, boundary=True)
    y2 = stft_lean.istft(Z2, L, hop)
    assert y.shape == y2.shape and np.max(np.abs(y - y2)) <= 1e-13
    assert np.max(np.abs(y2[:n] - x)) < 1e-12                                       # analysis-synthesis identity


def test_lean_istft_does_not_modify_its_input():
    _, Z = stft_lean.stft(np.random.default_rng(1).standard_normal(20000), 8000, 1024, 256)
    before = Z.copy(); stft_lean.istft(Z, 1024, 256)
    assert np.array_equal(Z, before)


# ---------------------------------------------------------------- lfilter one-pole smoother == the original per-frame Python loop
def test_noise_psd_tracker_matches_the_reference_loop():
    rng = np.random.default_rng(5)
    P = rng.random((129, 400)) ** 2 + 0.01
    smooth, bias, hop_s, window_s = 0.85, 1.3, 0.016, 1.5
    Ps = np.empty_like(P); Ps[:, 0] = P[:, 0]
    for j in range(1, P.shape[1]):
        Ps[:, j] = smooth * Ps[:, j - 1] + (1 - smooth) * P[:, j]
    ref = bias * minimum_filter1d(Ps, size=max(3, int(round(window_s / hop_s))), axis=1, mode="nearest")
    got = enh.track_noise_psd(P.copy(), hop_s, window_s, smooth, bias)
    assert np.max(np.abs(got - ref)) <= 1e-13 * ref.max()


def test_spectral_gate_matches_reference_formulation():
    """Reference = the original un-optimised formulation (np.convolve frequency smoothing, per-frame loop time smoothing, scipy stft/istft)."""
    fs, L = 16000, 1024
    rng = np.random.default_rng(11)
    t = np.arange(fs * 4) / fs
    x = 0.3 * np.sin(2 * np.pi * 500 * t) * (np.arange(t.size) > fs) + 0.05 * rng.standard_normal(t.size)
    hop = L // 4
    _, _, Z = signal.stft(x, fs=fs, window="hann", nperseg=L, noverlap=L - hop, boundary="zeros", padded=True)
    P = np.abs(Z) ** 2
    noise, _ = vc.estimate_noise_psd(P)
    strength, maxred, st = 0.6, 18.0, 0.6
    alpha, gmin = 1 + 2 * strength, 10 ** (-maxred / 20)
    G = np.sqrt(np.maximum(1.0 - alpha * noise[:, None] / np.maximum(P, 1e-30), gmin ** 2))
    k = np.ones(3) / 3
    G = np.apply_along_axis(lambda r: np.convolve(r, k, mode="same"), 0, G)
    g = G.copy()
    for j in range(1, g.shape[1]):
        g[:, j] = st * g[:, j - 1] + (1 - st) * G[:, j]
    G = np.maximum(g, gmin)
    _, ref = signal.istft(Z * G, fs=fs, window="hann", nperseg=L, noverlap=L - hop, boundary=True)
    ref = ref[: x.size]
    got = vc.spectral_gate(x, fs, strength, maxred, L, None)["y"]
    assert got.shape == ref.shape and np.max(np.abs(got - ref)) < 1e-12


# ---------------------------------------------------------------- per-channel filtering == whole-array filtering (bit-exact)
@pytest.mark.parametrize("method", ["causal", "zero_phase"])
def test_per_channel_filtering_is_bit_identical_to_array_filtering(method):
    rng = np.random.default_rng(2)
    x = rng.standard_normal((2, 20000))
    sos = flt.design_filter("bandpass", 4, [300.0, 3000.0], 16000.0)
    ref = signal.sosfilt(sos, x, axis=-1) if method == "causal" else signal.sosfiltfilt(sos, x, axis=-1)
    got = flt.apply_filter(x, sos, method)
    assert got.shape == x.shape and np.array_equal(got, ref)
    assert not np.shares_memory(got, x)                                              # the original is never modified in place


def test_zero_phase_on_short_signal_still_raises_clear_error():
    sos = flt.design_filter("lowpass", 8, [1000.0], 16000.0)
    with pytest.raises(flt.FilterError, match="too short"):
        flt.apply_filter(np.zeros((1, 10)), sos, "zero_phase")


# ---------------------------------------------------------------- VAD view-based framing == index-matrix framing
def test_vad_pitch_features_match_the_index_matrix_reference():
    fs = 16000
    t = np.arange(fs * 3) / fs
    x = 0.3 * np.sin(2 * np.pi * 150 * t) * (t > 1) + 0.01 * np.random.default_rng(4).standard_normal(t.size)
    f = vad.pitch_features(x, fs)
    L, H = int(round(48 * fs / 1000)), int(round(16 * fs / 1000))
    n = 1 + (x.size - L) // H
    fr = x[np.arange(n)[:, None] * H + np.arange(L)[None, :]]
    fr = fr - fr.mean(axis=1, keepdims=True)
    ref_db = 10 * np.log10(np.mean(fr ** 2, axis=1) + 1e-12)
    assert f["energy_db"].shape == ref_db.shape and np.max(np.abs(f["energy_db"] - ref_db)) < 1e-9


# ---------------------------------------------------------------- block-wise decode
def _wav(x, fs, subtype):
    b = io.BytesIO(); sf.write(b, x, fs, format="WAV", subtype=subtype); return b.getvalue()


def test_blockwise_decode_equals_soundfile_read_across_block_boundaries():
    fs, n = 8000, (1 << 20) * 2 + 12345                       # 2 full blocks plus a partial one
    x = np.random.default_rng(8).uniform(-0.9, 0.9, size=(n, 2))
    data = _wav(x, fs, "PCM_16")
    ref, _ = sf.read(io.BytesIO(data), dtype="float64", always_2d=True)
    dec = audio_io.decode_audio(data)
    assert dec["samples"].shape == (2, n) and dec["samples"].flags.c_contiguous
    assert np.array_equal(dec["samples"], ref.T) and dec["sample_rate"] == fs


def test_decode_rejects_too_many_channels_before_allocating(monkeypatch):
    x = np.zeros((1000, 3))
    data = _wav(x, 8000, "PCM_16")
    called = {"n": 0}
    real = np.empty
    monkeypatch.setattr(audio_io.np, "empty", lambda *a, **k: called.__setitem__("n", called["n"] + 1) or real(*a, **k))
    with pytest.raises(audio_io.AudioError, match="3 channels"):
        audio_io.decode_audio(data)
    assert called["n"] == 0                                    # rejected from the header, nothing proportional to the file was allocated


def test_truncated_wav_is_still_rejected_by_the_blockwise_decoder():
    data = _wav(np.random.default_rng(1).uniform(-0.5, 0.5, (40000, 1)), 16000, "PCM_16")
    with pytest.raises(audio_io.AudioError, match="truncated"):
        audio_io.decode_audio(data[: len(data) // 2])
