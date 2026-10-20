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
