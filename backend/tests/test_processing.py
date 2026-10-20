import numpy as np
import pytest
from app.processing.statistics import audio_statistics, time_axis, downsample_minmax
from app.processing.fft_analysis import single_sided_spectrum, find_spectral_peaks
from app.processing.spectrogram import stft_db
from app.processing.filters import run_filter, FilterError, validate_filter
from app.processing.comparison import compare_signals
from synth import tone, noise

FS = 16000

def test_statistics_known_values():
    x = tone(1000, FS, 1.0, amp=0.5)
    s = audio_statistics(x, FS)
    c = s["per_channel"][0]
    assert s["samples_per_channel"] == FS and abs(s["duration_s"] - 1.0) < 1e-12
    assert abs(c["rms"] - 0.5 / np.sqrt(2)) < 1e-6
    assert abs(c["variance"] - 0.125) < 1e-6          # population variance
    assert abs(c["mean"]) < 1e-9 and abs(c["peak_abs"] - 0.5) < 1e-6

def test_silence_no_division_error():
    s = audio_statistics(np.zeros(1000), FS)
    assert s["per_channel"][0]["crest_factor"] is None
    assert any("silence" in w for w in s["warnings"])
    sp = single_sided_spectrum(np.zeros(1000), FS)
    assert np.all(sp["amplitude"] == 0) and find_spectral_peaks(sp["freqs_hz"], sp["amplitude"]) == []

def test_time_axis():
    t = time_axis(5, 8000)
    assert np.allclose(t, [0, 1/8000, 2/8000, 3/8000, 4/8000])

def test_clipping_warning():
    x = np.clip(tone(100, FS, 1.0, amp=2.0), -1, 1)
    assert any("clipping" in w for w in audio_statistics(x, FS)["warnings"])

def test_downsample_preserves_extrema():
    x = noise(100000, 3); x[54321] = 9.0; x[12345] = -9.0
    i, v = downsample_minmax(x, 2000)
    assert v.max() == 9.0 and v.min() == -9.0 and i.size <= 2100

def test_fft_peak_and_amplitude_bin_centre():
    # 1000 Hz with N=16000 -> bin centre, df = 1 Hz
    x = tone(1000, FS, 1.0, amp=0.8)
    for win in ("rect", "hann"):
        sp = single_sided_spectrum(x, FS, win)
        k = np.argmax(sp["amplitude"])
        assert sp["freqs_hz"][k] == 1000.0
        assert abs(sp["amplitude"][k] - 0.8) < 5e-3, win

def test_fft_peak_off_bin_interpolated():
    x = tone(1000.37, FS, 1.0, amp=1.0)
    sp = single_sided_spectrum(x, FS, "hann")
    pk = find_spectral_peaks(sp["freqs_hz"], sp["amplitude"], 1)[0]
    assert abs(pk["frequency_hz"] - 1000.37) < 0.1
    # log-parabolic amplitude on a Hann main lobe is approximate (~2%); raw bin max shows ~8% scalloping loss
    assert abs(pk["amplitude"] - 1.0) < 0.04
    assert sp["amplitude"].max() < pk["amplitude"]

def test_two_tones_and_dc_nyquist_scaling():
    x = tone(500, FS, 1.0, 0.3) + tone(2500, FS, 1.0, 0.6)
    sp = single_sided_spectrum(x, FS, "hann")
    p = sorted(find_spectral_peaks(sp["freqs_hz"], sp["amplitude"], 2), key=lambda d: d["frequency_hz"])
    assert abs(p[0]["frequency_hz"] - 500) < 0.1 and abs(p[1]["frequency_hz"] - 2500) < 0.1
    assert abs(p[0]["amplitude"] - 0.3) < 0.01 and abs(p[1]["amplitude"] - 0.6) < 0.01
    dc = single_sided_spectrum(np.full(1000, 0.25), FS, "rect")
    assert abs(dc["amplitude"][0] - 0.25) < 1e-12
    ny = single_sided_spectrum(0.4 * np.cos(np.pi * np.arange(1000)), FS, "rect")
    assert abs(ny["amplitude"][-1] - 0.4) < 1e-12 and ny["freqs_hz"][-1] == FS / 2

def test_zero_padding_keeps_amplitude_and_resolution_note():
    x = tone(1000, FS, 0.5, 1.0)
    sp = single_sided_spectrum(x, FS, "hann", n_fft=65536)
    assert abs(sp["amplitude"].max() - 1.0) < 0.02
    assert sp["bin_spacing_hz"] < sp["nominal_resolution_hz"]
    with pytest.raises(ValueError):
        single_sided_spectrum(x, FS, "hann", n_fft=100)

def test_hann_reduces_leakage():
    x = tone(1000.5, FS, 1.0)
    r = single_sided_spectrum(x, FS, "rect"); h = single_sided_spectrum(x, FS, "hann")
    far = (r["freqs_hz"] > 3000)
    assert h["amplitude"][far].max() < 0.1 * r["amplitude"][far].max()

def test_spectrogram_axes_and_level():
    x = tone(2000, FS, 2.0, 1.0)
    S = stft_db(x, FS, 1024, 256)
    assert S["magnitude_db"].shape == (513, 1 + (len(x) - 1024) // 256)
    assert abs(S["freqs_hz"][1] - FS / 1024) < 1e-12 and S["freqs_hz"][-1] == FS / 2
    assert abs(S["times_s"][0] - 512 / FS) < 1e-12
    k = S["magnitude_db"][:, 5].argmax()
    assert abs(S["freqs_hz"][k] - 2000) <= FS / 1024
    assert abs(S["magnitude_db"][k, 5]) < 1.5      # ~0 dB re full scale

def test_spectrogram_tracks_chirp_and_short_silent():
    t = np.arange(2 * FS) / FS
    x = np.sin(2 * np.pi * (500 * t + 1000 * t ** 2 / 2))   # 500 -> 2500 Hz
    S = stft_db(x, FS, 1024, 256)
    f = S["freqs_hz"][S["magnitude_db"].argmax(axis=0)]
    assert np.all(np.diff(f[::10]) > 0) and abs(f[0] - 500) < 120 and abs(f[-1] - 2500) < 120
    short = stft_db(np.zeros(100), FS, 1024)
    assert short["zero_padded_short_signal"] and np.all(short["magnitude_db"] == -120)

def _gain(y, x, f):
    s = single_sided_spectrum(y, FS, "hann"); k = int(np.argmin(abs(s["freqs_hz"] - f)))
    s0 = single_sided_spectrum(x, FS, "hann")
    return s["amplitude"][k] / s0["amplitude"][k]

def test_lowpass_highpass_attenuation():
    fs = FS
    x = tone(300, fs, 1) + tone(4000, fs, 1)
    lp = run_filter(x, fs, "lowpass", 6, [1000], "zero_phase")["output"][0]
    assert _gain(lp, x, 4000) < 1e-3 and 0.95 < _gain(lp, x, 300) < 1.05
    hp = run_filter(x, fs, "highpass", 6, [1000], "zero_phase")["output"][0]
    assert _gain(hp, x, 300) < 1e-3 and 0.95 < _gain(hp, x, 4000) < 1.05

def test_bandpass_and_notch():
    x = tone(300, FS) + tone(1500, FS) + tone(5000, FS)
    bp = run_filter(x, FS, "bandpass", 6, [1000, 2000], "zero_phase")["output"][0]
    assert _gain(bp, x, 300) < 1e-2 and _gain(bp, x, 5000) < 1e-2 and _gain(bp, x, 1500) > 0.9
    bs = run_filter(x, FS, "bandstop", 6, [1200, 1800], "zero_phase")["output"][0]
    assert _gain(bs, x, 1500) < 0.05 and _gain(bs, x, 300) > 0.95

def test_cutoff_minus3db_causal_and_minus6db_zero_phase():
    r = run_filter(tone(100, FS), FS, "lowpass", 4, [1000], "causal")["response"]
    k = np.argmin(abs(r["freqs_hz"] - 1000)); assert abs(r["magnitude_db"][k] + 3.01) < 0.1
    r = run_filter(tone(100, FS), FS, "lowpass", 4, [1000], "zero_phase")["response"]
    k = np.argmin(abs(r["freqs_hz"] - 1000)); assert abs(r["magnitude_db"][k] + 6.02) < 0.2

def test_causal_has_delay_zero_phase_does_not():
    x = tone(200, FS, 1.0)
    z = run_filter(x, FS, "lowpass", 4, [2000], "zero_phase")["output"][0]
    c = run_filter(x, FS, "lowpass", 4, [2000], "causal")["output"][0]
    sl = slice(2000, 14000)
    assert np.max(abs(z[sl] - x[sl])) < 1e-3 and np.max(abs(c[sl] - x[sl])) > 1e-2

@pytest.mark.parametrize("args", [
    ("lowpass", 4, [8000]), ("lowpass", 4, [9000]), ("lowpass", 4, [-5]), ("lowpass", 4, [float("nan")]),
    ("bandpass", 4, [2000, 1000]), ("bandpass", 4, [1000]), ("lowpass", 0, [100]), ("lowpass", 13, [100]),
    ("notch", 4, [100]), ("bandstop", 4, [100, 8000])])
def test_invalid_filter_params_rejected(args):
    with pytest.raises(FilterError):
        validate_filter(args[0], args[1], args[2], FS, "causal")

def test_short_recording_zero_phase_rejected_causal_ok():
    x = noise(10)
    with pytest.raises(FilterError):
        run_filter(x, FS, "lowpass", 4, [1000], "zero_phase")
    assert run_filter(x, FS, "lowpass", 4, [1000], "causal")["output"].shape == (1, 10)

def test_stereo_channels_preserved_independently():
    st = np.vstack([tone(300, FS), tone(4000, FS)])
    y = run_filter(st, FS, "lowpass", 6, [1000], "zero_phase")["output"]
    assert y.shape == st.shape
    e = 500   # skip documented edge-effect region
    assert np.std(y[0][e:-e]) > 0.6 and np.std(y[1][e:-e]) < 1e-6

def test_comparison_metrics():
    x = tone(500, FS, 1.0, 1.0)
    r = compare_signals(x, 0.5 * x)["per_channel"][0]
    assert abs(r["mse"] - np.mean((0.5 * x) ** 2)) < 1e-12 and abs(r["rms_change_db"] + 6.0206) < 1e-3
    assert compare_signals(x, x)["per_channel"][0]["mse"] == 0
    with pytest.raises(ValueError):
        compare_signals(x, x[:-1])
