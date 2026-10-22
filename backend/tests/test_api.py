"""API tests (need: pip install -r requirements.txt). Numerical assertions, not just status codes."""
import io
import numpy as np
import soundfile as sf
from fastapi.testclient import TestClient
from app.main import app
from synth import tone, siren

c = TestClient(app)
FS = 16000

def wav_bytes(x, fs=FS):
    b = io.BytesIO(); sf.write(b, np.atleast_2d(x).T if np.ndim(x) > 1 else x, fs, format="WAV", subtype="FLOAT"); return b.getvalue()

def upload(x, fs=FS):
    r = c.post("/api/v1/audio/upload", files={"file": ("a.wav", wav_bytes(x, fs), "audio/wav")}); return r

def test_health(): assert c.get("/api/v1/health").json()["status"] == "ok"

def test_upload_metadata_exact():
    j = upload(tone(1000, FS, 1.5, 0.5)).json()
    assert j["metadata"]["sample_rate_hz"] == FS and j["metadata"]["samples_per_channel"] == 24000
    assert abs(j["statistics"]["per_channel"][0]["rms"] - 0.5 / np.sqrt(2)) < 1e-4

def test_rejects_non_wav_and_corrupt():
    assert c.post("/api/v1/audio/upload", files={"file": ("a.wav", b"hello world" * 20, "audio/wav")}).status_code == 422
    good = wav_bytes(tone(500))
    assert c.post("/api/v1/audio/upload", files={"file": ("a.wav", good[:30], "audio/wav")}).status_code == 422
    r = c.post("/api/v1/audio/upload", files={"file": ("a.wav", good[:100], "audio/wav")})      # header ok, audio cut off
    assert r.status_code == 422 and "truncated" in r.json()["detail"]

def test_filter_roundtrip_download_readback():
    x = tone(300, FS) + tone(4000, FS)
    aid = upload(x).json()["metadata"]["audio_id"]
    r = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "order": 6, "cutoff_hz": [1000]})
    assert r.status_code == 200
    y, fs = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{r.json()['job_id']}/download").content))
    assert fs == FS and y.shape[0] == x.size
    assert abs(np.std(y[500:-500]) - 0.7071) < 0.01          # only the 300 Hz tone remains

def test_invalid_cutoff_422():
    aid = upload(tone(300)).json()["metadata"]["audio_id"]
    assert c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "cutoff_hz": [9000]}).status_code == 422

def test_stereo_preserved():
    st = np.vstack([tone(300), tone(4000)])
    aid = upload(st).json()["metadata"]["audio_id"]
    j = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "order": 6, "cutoff_hz": [1000]}).json()
    y, _ = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{j['job_id']}/download").content))
    assert y.shape == (FS, 2) and np.std(y[500:-500, 1]) < 1e-3

def test_roadsonic_detect_and_exports():
    x = np.concatenate([np.zeros(FS * 2), siren(FS, 4.0), np.zeros(FS * 2)])
    aid = upload(x).json()["metadata"]["audio_id"]
    j = c.post(f"/api/v1/roadsonic/{aid}/detect", json={}).json()
    assert len(j["events"]) == 1 and abs(j["events"][0]["start_s"] - 2.0) < 0.6
    assert "start_s" in c.get(f"/api/v1/roadsonic/{j['job_id']}/export?kind=events_csv").text

def test_unknown_ids_404():
    assert c.get("/api/v1/clearvoice/nope/download").status_code == 404


def test_presets_listed():
    j = c.get("/api/v1/clearvoice/presets").json()
    assert "speech_clarity" in j["presets"] and "telephone_band" in j["presets"]

def test_voice_pipeline_endpoint_history_quality_and_downloads():
    from synth import speech_like, noise
    sp = speech_like(FS, 3.0); x = np.concatenate([np.zeros(int(0.8 * FS)), sp]) + noise(int(3.8 * FS), 1, 0.04)
    aid = upload(x).json()["metadata"]["audio_id"]
    r = c.post(f"/api/v1/clearvoice/{aid}/voice", json={"preset": "speech_clarity"})
    assert r.status_code == 200
    j = r.json()
    assert j["quality"]["ok"] and [h["stage"] for h in j["history"]] == ["dc_removal", "rumble_highpass", "noise_reduction"]
    y, fs = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{j['job_id']}/download").content))
    assert fs == FS and y.shape[0] == x.size and np.all(np.isfinite(y))
    y16, _ = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{j['job_id']}/download?subtype=pcm16").content))
    assert np.max(abs(y16 - y)) < 2e-4
    assert c.get(f"/api/v1/clearvoice/{j['job_id']}/export?kind=history").json()["history"]
    assert c.post(f"/api/v1/clearvoice/{aid}/voice", json={"preset": "nope"}).status_code == 422

def test_spectrogram_csv_has_documented_header_and_shape():
    aid = upload(tone(2000, FS, 1.0)).json()["metadata"]["audio_id"]
    job = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "cutoff_hz": [4000]}).json()["job_id"]
    txt = c.get(f"/api/v1/clearvoice/{job}/export?kind=spectrogram_filtered&frame_length=512&hop_length=256").text.splitlines()
    assert txt[0].startswith("# rows = time frames") and txt[2].split(",")[0] == "time_s" and len(txt[2].split(",")) == 257 + 1
    assert c.get(f"/api/v1/clearvoice/{job}/export?kind=spectrogram_filtered&channel=5").status_code == 422

def test_pcm16_download_refused_when_it_would_clip():
    aid = upload(tone(500, FS, 0.5, 0.9)).json()["metadata"]["audio_id"]
    job = c.post(f"/api/v1/clearvoice/{aid}/voice", json={"preset": "manual", "overrides": {"loudness": {"enabled": True, "target_peak_dbfs": 0.0}}}).json()["job_id"]
    assert c.get(f"/api/v1/clearvoice/{job}/download?subtype=pcm16").status_code == 409     # peak exactly full scale
    assert c.get(f"/api/v1/clearvoice/{job}/download").status_code == 200                   # float32 is always allowed

def test_health_reports_audio_capabilities():
    j = c.get("/api/v1/health").json()
    assert "ffmpeg" in j["audio_io"] and "soundfile" in j["audio_io"]


def test_lecture_speech_preset_endpoint_reports_time_history_and_improves_snr():
    from synth import speech_like_realistic, noise
    segs = []
    for i in range(4): segs += [speech_like_realistic(FS, 1.5, i), np.zeros(int(0.7 * FS))]
    clean = np.concatenate([np.zeros(FS // 2)] + segs); noisy = clean + noise(clean.size, 0, 0.03)
    aid = upload(noisy).json()["metadata"]["audio_id"]
    j = c.post(f"/api/v1/clearvoice/{aid}/voice", json={"preset": "lecture_speech"}).json()
    assert j["processing_s"] > 0 and "speech_gate" in [h["stage"] for h in j["history"]]
    y, fs = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{j['job_id']}/download").content))
    snr = lambda ref, z: 10 * np.log10(np.sum(ref ** 2) / np.sum((z[:ref.size] - ref) ** 2))
    assert fs == FS and snr(clean, y) > snr(clean, noisy) + 2.0
    assert not np.array_equal(y, noisy)                          # not a copy of the input

def test_reprocessing_gives_new_job_and_download_matches_latest_settings():
    aid = upload(tone(300, FS) + tone(4000, FS)).json()["metadata"]["audio_id"]
    j1 = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "order": 6, "cutoff_hz": [1000]}).json()
    j2 = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "highpass", "order": 6, "cutoff_hz": [1000]}).json()
    assert j1["job_id"] != j2["job_id"]
    y1, _ = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{j1['job_id']}/download").content))
    y2, _ = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{j2['job_id']}/download").content))
    s = lambda z, f: abs(np.fft.rfft(z[500:-500] * np.hanning(z.size - 1000)))[int(f * (z.size - 1000) / FS)]
    assert s(y1, 300) > 100 * s(y1, 4000) and s(y2, 4000) > 100 * s(y2, 300)     # each download is its own latest result


# ------------------------------------------------------------------ RoadSonic API (needs FastAPI/httpx)
def _siren_upload(fs=FS, stereo=False):
    x = np.concatenate([np.zeros(fs * 2), siren(fs, 4.0), np.zeros(fs * 2)])
    return upload(np.column_stack([x, x]) if stereo else x, fs).json()["metadata"]["audio_id"], x

def test_roadsonic_defaults_endpoint_matches_detector():
    j = c.get("/api/v1/roadsonic/defaults").json()
    assert j["params"]["detector"]["min_event_s"]["default"] == 1.0 and "help" in j["params"]["analysis"]["frame_ms"]
    assert set(j["sensitivity_presets"]) == {"low", "medium", "high"}

def test_roadsonic_detect_defaults_schema_and_numbers():
    aid, _ = _siren_upload()
    j = c.post(f"/api/v1/roadsonic/{aid}/detect", json={}).json()
    assert j["detect_on"] == "original" and j["summary"]["n_events"] == 1 and j["summary"]["duration_s"] == 8.0
    e = j["events"][0]
    assert abs(e["start_s"] - 2.0) < 0.6 and abs(e["end_s"] - 6.0) < 0.6 and e["label"] == "candidate siren event"
    assert "explanation" in e and e["trajectory"]["freq_hz"] and e["heuristic_score"] <= 1
    assert len(j["spectrogram"]["magnitude_db"]) == len(j["spectrogram"]["freqs_hz"])
    assert set(j["tracks"]) >= {"time_s", "rms_db", "flatness", "dom_freq_hz", "tonal_ratio", "zcr"}
    assert j["spectrum"]["freqs_hz"][-1] == FS / 2 and j["processing_s"] > 0

def test_roadsonic_rejects_invalid_settings_with_422():
    aid, _ = _siren_upload()
    for body in ({"features": {"frame_ms": 50, "hop_ms": 80}}, {"features": {"frame_ms": 5}}, {"detector": {"min_event_s": -1}},
                 {"detector": {"min_tonal_ratio": 2}}, {"sensitivity": "extreme"}, {"detect_on": "other"},
                 {"preprocessing": {"filter": {"type": "notch"}}}, {"preprocessing": {"filter": {"type": "lowpass", "cutoff_hz": [99999]}}},
                 {"features": {"band_lo": 3000, "band_hi": 2000}}, {"features": {"band_hi": 9000}}, {"detect_on": "processed"}):
        r = c.post(f"/api/v1/roadsonic/{aid}/detect", json=body)
        assert r.status_code == 422, body
    assert c.post("/api/v1/roadsonic/nope/detect", json={}).status_code == 404

def test_roadsonic_preprocessing_compare_and_processed_audio():
    aid, x = _siren_upload()
    body = {"preprocessing": {"filter": {"type": "bandpass", "cutoff_hz": [2500, 3500]}}, "compare": True}
    j = c.post(f"/api/v1/roadsonic/{aid}/detect", json=body).json()
    assert j["detect_on"] == "processed" and j["summary"]["n_events"] == 0                       # filter removed the siren band
    assert j["comparison"]["original"]["n_events"] == 1 and j["comparison"]["processed"]["n_events"] == 0
    assert j["preprocessing"]["processing_steps"][0]["step"] == "filter" and j["spectrogram_original"] is not None
    y, fs = sf.read(io.BytesIO(c.get(f"/api/v1/roadsonic/{j['job_id']}/audio?version=processed").content))
    assert fs == FS and y.shape[0] == x.size and np.all(np.isfinite(y)) and np.max(np.abs(y)) <= 1.0
    o, _ = sf.read(io.BytesIO(c.get(f"/api/v1/roadsonic/{j['job_id']}/audio?version=original").content))
    assert np.max(np.abs(o - x)) < 1e-6                                                          # original preserved exactly
    plain = c.post(f"/api/v1/roadsonic/{aid}/detect", json={}).json()["job_id"]
    assert c.get(f"/api/v1/roadsonic/{plain}/audio?version=processed").status_code == 404

def test_roadsonic_event_clip_context_and_headers():
    aid, x = _siren_upload(stereo=True)
    j = c.post(f"/api/v1/roadsonic/{aid}/detect", json={}).json(); e = j["events"][0]
    r = c.get(f"/api/v1/roadsonic/{j['job_id']}/event/0/audio?pre=1&post=1")
    y, fs = sf.read(io.BytesIO(r.content)); a, b = float(r.headers["x-clip-start-s"]), float(r.headers["x-clip-end-s"])
    assert y.ndim == 2 and y.shape[1] == 2 and abs(a - max(0, e["start_s"] - 1)) < 1e-3 and abs(b - min(8.0, e["end_s"] + 1)) < 1e-3
    assert abs(y.shape[0] / fs - (b - a)) < 2 / fs and float(r.headers["x-event-start-s"]) == round(e["start_s"], 4)
    assert c.get(f"/api/v1/roadsonic/{j['job_id']}/event/5/audio").status_code == 404
    assert c.get(f"/api/v1/roadsonic/{j['job_id']}/event/0/audio?pre=99").status_code == 422

def test_roadsonic_evaluate_with_labels():
    aid, _ = _siren_upload()
    jid = c.post(f"/api/v1/roadsonic/{aid}/detect", json={}).json()["job_id"]
    r = c.post(f"/api/v1/roadsonic/{jid}/evaluate", json={"truth": [{"start_s": 2.0, "end_s": 6.0}]}).json()
    assert r["true_positives"] == 1 and r["false_positives"] == 0 and r["false_negatives"] == 0 and r["f1"] == 1.0
    r2 = c.post(f"/api/v1/roadsonic/{jid}/evaluate", json={"truth": [{"start_s": 0.0, "end_s": 1.0}]}).json()
    assert r2["true_positives"] == 0 and r2["false_positives"] == 1 and r2["false_negatives"] == 1
    assert c.post(f"/api/v1/roadsonic/{jid}/evaluate", json={"truth": [{"start_s": 1.0, "end_s": 99.0}]}).status_code == 422
    assert c.post(f"/api/v1/roadsonic/{jid}/evaluate", json={"truth": [{"start_s": 3.0, "end_s": 2.0}]}).status_code == 422

def test_roadsonic_exports_contain_real_data():
    aid, _ = _siren_upload()
    j = c.post(f"/api/v1/roadsonic/{aid}/detect", json={"sensitivity": "medium"}).json(); jid = j["job_id"]
    ev = c.get(f"/api/v1/roadsonic/{jid}/export?kind=events_csv").text.splitlines()
    assert ev[0].startswith("start_s,end_s,duration_s,label") and len(ev) == 2 and ev[1].split(",")[3] == "candidate siren event"
    ft = c.get(f"/api/v1/roadsonic/{jid}/export?kind=features_csv").text.splitlines()
    assert ft[0] == "time_s,rms_db,centroid_hz,bandwidth_hz,flatness,dom_freq_hz,peak_prominence_db,tonal_ratio,zcr" and len(ft) > 100
    res = c.get(f"/api/v1/roadsonic/{jid}/export?kind=results_json").json()
    assert res["summary"]["n_events"] == 1 and res["config"]["request"]["sensitivity"] == "medium" and "Academic prototype" in res["disclaimer"]
    assert c.get(f"/api/v1/roadsonic/{jid}/export?kind=other").status_code == 422
    assert c.get("/api/v1/roadsonic/nope/export").status_code == 404

def test_roadsonic_report_html_and_unknown_job():
    aid, _ = _siren_upload()
    jid = c.post(f"/api/v1/roadsonic/{aid}/detect", json={}).json()["job_id"]
    h = c.get(f"/api/v1/roadsonic/{jid}/report?format=html"); assert h.status_code == 200 and "Why each interval was flagged" in h.text
    assert c.get(f"/api/v1/roadsonic/{jid}/report?format=docx").status_code == 422
    vj = c.post(f"/api/v1/clearvoice/{upload(tone(300)).json()['metadata']['audio_id']}/filter", json={"filter_type": "lowpass", "cutoff_hz": [1000]}).json()["job_id"]
    assert c.get(f"/api/v1/roadsonic/{vj}/export").status_code == 404                           # a ClearVoice job is not a RoadSonic job

def test_roadsonic_stereo_and_sample_rates_via_api():
    for fs in (8000, 44100):
        aid, _ = _siren_upload(fs, stereo=True)
        j = c.post(f"/api/v1/roadsonic/{aid}/detect", json={"preprocessing": {"channel_mode": "mix"}}).json()
        assert j["summary"]["sample_rate_hz"] == fs and j["summary"]["channels"] == 2 and j["summary"]["n_events"] == 1
