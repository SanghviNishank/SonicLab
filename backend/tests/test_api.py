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
    assert c.post("/api/v1/audio/upload", files={"file": ("a.wav", good[:100], "audio/wav")}).status_code == 422

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
    aid = upload(st.T).json()["metadata"]["audio_id"]
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
