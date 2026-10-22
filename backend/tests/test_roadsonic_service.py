"""RoadSonic orchestration tests (preprocessing, version selection, comparison, clips, defaults). Requests are plain
namespaces mirroring the pydantic models, so these run without FastAPI; the pydantic validation itself is exercised by test_api."""
import numpy as np
import pytest
from types import SimpleNamespace as NS
from app.services import roadsonic as rs
from app.processing import filters as flt
from app.schemas.roadsonic_params import PARAMS
from synth import siren, tone, noise, traffic_like

FS = 16000
DET = dict(window_s=1.0, window_step_s=0.1, min_rms_db=-60.0, min_tonal_ratio=0.5, min_tonal_fraction=0.6, min_f0_range_hz=150.0,
           min_f0_std_hz=40.0, merge_gap_s=0.5, min_event_s=1.0, max_event_s=0.0, min_peak_prominence_db=0.0)

def pre_cfg(ftype="none", cutoff=(), nr=False, mode="mix", dc=True, method="zero_phase"):
    return NS(channel_mode=mode, remove_dc=dc, filter=NS(type=ftype, cutoff_hz=list(cutoff), order=4, method=method),
              noise_reduction=NS(enabled=nr, strength=0.7, max_reduction_db=18.0), active=(ftype != "none" or nr))

def req(pre=None, detect_on="auto", compare=False, sensitivity=None, det=None, feats=None):
    d = dict(DET); d.update(det or {})
    f = dict(frame_ms=64.0, hop_ms=16.0, band_lo=450.0, band_hi=2000.0); f.update(feats or {})
    return NS(sensitivity=sensitivity, features=NS(**f), detector=NS(model_dump=lambda: dict(d)), preprocessing=pre or pre_cfg(),
              detect_on=detect_on, compare=compare)

def scene(fs=FS, lead=2.0, sir=4.0, tail=2.0, amp=0.5):
    return np.concatenate([np.zeros(int(fs * lead)), siren(fs, sir, amp=amp), np.zeros(int(fs * tail))])

def test_original_audio_is_never_modified_by_preprocessing():
    x = np.vstack([scene(), scene()]); x0 = x.copy()
    rs.run(x, FS, req(pre_cfg("bandpass", (400, 2500), nr=True), compare=True))
    assert np.array_equal(x, x0)

def test_default_run_has_no_processed_version_and_detects_one_event():
    R = rs.run(np.atleast_2d(scene()), FS, req())
    assert R["use"] == "original" and R["pre"]["processed"] is None and R["spectrogram_original"] is None
    assert len(R["main"]["events"]) == 1 and abs(R["main"]["events"][0]["start_s"] - 2.0) < 0.6

def test_auto_uses_processed_when_preprocessing_is_configured_and_says_so():
    R = rs.run(np.atleast_2d(scene()), FS, req(pre_cfg("bandpass", (400, 2500))))
    assert R["use"] == "processed" and R["active"] and R["pre"]["processing_steps"][0]["step"] == "filter"
    assert R["pre"]["processing_steps"][0]["detail"]["method"] == "zero_phase"

def test_detect_on_processed_without_preprocessing_is_an_error():
    with pytest.raises(ValueError): rs.run(np.atleast_2d(scene()), FS, req(detect_on="processed"))

def test_filtering_away_the_siren_band_loses_the_event_and_comparison_shows_both():
    """Documented risk: preprocessing can remove the evidence. Both versions are analysed with identical settings."""
    R = rs.run(np.atleast_2d(scene()), FS, req(pre_cfg("bandpass", (2500, 3500)), compare=True))
    assert R["use"] == "processed" and len(R["main"]["events"]) == 0
    o, a = R["other"]; assert o == "original" and len(a["events"]) == 1

def test_invalid_filter_settings_are_rejected_with_filter_error():
    with pytest.raises(flt.FilterError): rs.run(np.atleast_2d(scene()), FS, req(pre_cfg("lowpass", (9000,))))      # above Nyquist
    with pytest.raises(flt.FilterError): rs.run(np.atleast_2d(scene()), FS, req(pre_cfg("bandpass", (2000, 1000))))

def test_band_above_nyquist_is_rejected_for_low_sample_rates():
    with pytest.raises(ValueError): rs.run(np.atleast_2d(scene(fs=3000)), 3000, req())            # band_hi 2000 >= 1500

def test_stereo_channel_modes_and_antiphase_cancellation():
    s = scene(); x = np.vstack([s, -s])
    assert len(rs.run(x, FS, req(pre_cfg(mode="mix")))["main"]["events"]) == 0                   # cancels (documented)
    assert len(rs.run(x, FS, req(pre_cfg(mode="0")))["main"]["events"]) == 1
    assert len(rs.run(x, FS, req(pre_cfg(mode="1")))["main"]["events"]) == 1
    with pytest.raises(ValueError): rs.run(np.atleast_2d(s), FS, req(pre_cfg(mode="1")))
    only_right = np.vstack([np.zeros_like(s), s]); assert len(rs.run(only_right, FS, req(pre_cfg(mode="mix")))["main"]["events"]) == 1

def test_settings_change_the_analysis():
    x = np.atleast_2d(scene(sir=1.6))
    assert len(rs.run(x, FS, req(det=dict(min_event_s=1.0)))["main"]["events"]) == 1
    assert len(rs.run(x, FS, req(det=dict(min_event_s=3.0)))["main"]["events"]) == 0
    assert len(rs.run(np.atleast_2d(scene()), FS, req(det=dict(min_f0_range_hz=4000.0)))["main"]["events"]) == 0   # impossible modulation demand
    r = rs.run(np.atleast_2d(scene()), FS, req(feats=dict(frame_ms=100.0, hop_ms=20.0)))
    assert r["main"]["feat"]["meta"]["frame_ms"] == 100.0 and r["main"]["feat"]["meta"]["hop_length"] == 320

def test_sensitivity_preset_overrides_threshold_fields_only():
    x = np.atleast_2d(scene())
    low = rs.run(x, FS, req(sensitivity="low", det=dict(min_event_s=2.0)))["main"]
    assert low["detector"]["min_f0_range_hz"] == 200.0 and low["detector"]["min_event_s"] == 2.0

def test_noise_reduction_stage_runs_and_is_logged():
    R = rs.run(np.atleast_2d(scene() + noise(FS * 8, 3, 0.02)), FS, req(pre_cfg(nr=True)))
    st = R["pre"]["processing_steps"][0]; assert st["step"] == "noise_reduction" and st["detail"]["method"].startswith("adaptive")
    assert np.all(np.isfinite(R["pre"]["processed"])) and R["pre"]["processed"].shape == (FS * 8,)

def test_display_payload_contracts():
    R = rs.run(np.atleast_2d(scene()), FS, req())
    sg = R["spectrogram"]; assert len(sg["magnitude_db"]) == len(sg["freqs_hz"]) and len(sg["magnitude_db"][0]) == len(sg["times_s"])
    assert sg["freqs_hz"][-1] <= FS / 2 and sg["times_s"][-1] <= 8.0
    tr = rs.tracks_payload(R["main"]["feat"]); n = len(tr["time_s"]); assert all(len(v) == n for v in tr.values())
    sp = R["spectrum"]; assert len(sp["freqs_hz"]) == len(sp["amplitude"]) and sp["freqs_hz"][-1] == FS / 2
    peak = sp["peaks"][0]["frequency_hz"]; assert 580 < peak < 1420            # strongest peak lies inside the 600-1400 Hz sweep

def test_long_recording_spectrum_is_limited_and_labelled():
    sp = rs.spectrum_payload(np.zeros(2 ** 21 + 5000), 16000)
    assert "centre" in sp["analysed"] and len(sp["freqs_hz"]) <= 6000

def test_spectrogram_frames_are_bounded_for_long_audio():
    fs = 44100; x = np.zeros(fs * 120)
    g = rs.spectrogram_payload(x, fs)
    assert len(g["times_s"]) <= 600 and len(g["freqs_hz"]) <= 200 and g["frame_length"] >= 2048 and g["hop_length"] <= g["frame_length"]
    assert 1 + (x.size - g["frame_length"]) // g["hop_length"] <= 4001            # analysed frames bounded (memory)

def test_event_clip_context_is_clamped_and_exact():
    x = np.atleast_2d(scene()); R = rs.run(x, FS, req()); e = R["main"]["events"][0]
    clip, i0, i1 = rs.event_clip(x, FS, e, 2.0, 2.0)
    assert i0 == int(round(max(0, e["start_s"] - 2.0) * FS)) and i1 == int(round(min(8.0, e["end_s"] + 2.0) * FS))
    assert clip.shape == (1, i1 - i0) and np.array_equal(clip, x[:, i0:i1])
    c2, a, b = rs.event_clip(x, FS, e, 0.0, 0.0); assert abs((b - a) / FS - e["duration_s"]) < 2 / FS
    c3, a3, _ = rs.event_clip(x, FS, e, 30.0, 30.0); assert a3 == 0
    with pytest.raises(ValueError): rs.event_clip(x, FS, e, 31.0, 0.0)

def test_defaults_payload_matches_detector_and_feature_defaults():
    from app.processing.siren_detector import DetectorConfig
    d = rs.defaults_payload()["params"]; cfg = DetectorConfig()
    for k, v in d["detector"].items():
        assert getattr(cfg, k) == v["default"], k
        assert v["min"] <= v["default"] <= v["max"] and v["help"] and v["label"]
    assert d["analysis"]["frame_ms"]["default"] == 64.0 and d["analysis"]["band_hi"]["default"] == 2000.0
    assert all(p[1] <= p[0] <= p[2] for p in PARAMS.values())

@pytest.mark.parametrize("fs", [8000, 22050, 44100, 48000])
def test_end_to_end_across_sample_rates_with_correct_time_axes(fs):
    R = rs.run(np.atleast_2d(scene(fs=fs)), fs, req())
    e = R["main"]["events"]; assert len(e) == 1 and abs(e[0]["start_s"] - 2.0) < 0.6 and abs(e[0]["end_s"] - 6.0) < 0.6
    assert R["main"]["feat"]["meta"]["sample_rate"] == fs and abs(R["main"]["feat"]["meta"]["duration_s"] - 8.0) < 1e-9

def test_traffic_noise_horn_and_silence_give_empty_results():
    n = FS * 8
    horn = np.zeros(n); horn[FS:6 * FS] = tone(440, FS, 5.0, 0.5) + tone(550, FS, 5.0, 0.4)
    for x in (np.zeros(n), traffic_like(n, FS, 1, 0.3), horn + traffic_like(n, FS, 2, 0.2), noise(n, 4, 0.2)):
        assert rs.run(np.atleast_2d(x), FS, req())["main"]["events"] == []

def test_very_short_audio_does_not_crash():
    for n in (10, 500, 2000):
        assert rs.run(np.atleast_2d(noise(n, 1, 0.1)), FS, req())["main"]["events"] == []
