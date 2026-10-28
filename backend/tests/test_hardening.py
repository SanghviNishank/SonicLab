"""Hardening regression tests: strict request validation, memory budget, concurrency gate, request-size guard, error leakage.

Each test documents the defect it guards against (found by probing the API with malformed input / measuring memory).
"""
import io
import threading
import types
import numpy as np
import pytest
import soundfile as sf
from fastapi.testclient import TestClient

import app.main as app_main
from app.main import app
from app.core import limits
from app.services import store
from app.api import routes
from synth import tone

c = TestClient(app, raise_server_exceptions=False)
FS = 16000


def _wav(x, fs=FS, subtype="FLOAT"):
    b = io.BytesIO(); sf.write(b, x, fs, format="WAV", subtype=subtype); return b.getvalue()


def _upload(x, fs=FS):
    r = c.post("/api/v1/audio/upload", files={"file": ("a.wav", _wav(x, fs), "audio/wav")})
    assert r.status_code == 200, r.text
    return r.json()["metadata"]["audio_id"]


# ---------------------------------------------------------------- voice overrides: was a free-form dict (HTTP 500 / silently ignored)
@pytest.mark.parametrize("overrides", [
    {"rumble": 5},                                                   # was HTTP 500 (TypeError)
    {"rumble": {"enabled": True, "cutoff_hz": None}},                # was HTTP 500
    {"noise_reduction": {"enabled": True, "noise_segment_s": "ab"}},  # was HTTP 500
    {"noise_reducton": {"enabled": True}},                           # typo: was silently ignored (setting never applied)
    {"method": "sideways"},                                          # was silently accepted when no filter stage ran
    {"noise_reduction": {"enabled": True, "strength": 9}},
    {"noise_reduction": {"enabled": True, "frame_length": 1000}},    # not a power of two
    {"band_limit": {"enabled": True, "lowpass_hz": 1000, "order": 99}},
    {"loudness": {"enabled": True, "target_peak_dbfs": 6}},          # +6 dBFS target would clip
    {"rumble": None},
])
def test_voice_overrides_are_validated_with_422_never_500(overrides):
    aid = _upload(tone(440, FS, 1.0, 0.3))
    r = c.post(f"/api/v1/clearvoice/{aid}/voice", json={"preset": "manual", "overrides": overrides})
    assert r.status_code == 422, (r.status_code, r.text[:200])


def test_valid_voice_overrides_are_merged_onto_the_preset_and_actually_applied():
    """Only fields the caller sent change; the rest of the preset stays. Output differs from the input in the intended way."""
    fs = FS
    t = np.arange(fs * 2) / fs
    x = 0.3 * np.sin(2 * np.pi * 1000 * t) + 0.3 * np.sin(2 * np.pi * 40 * t)             # speech-band tone + 40 Hz rumble
    aid = _upload(x)
    r = c.post(f"/api/v1/clearvoice/{aid}/voice", json={"preset": "manual", "overrides": {"rumble": {"enabled": True, "cutoff_hz": 100.0}}})
    assert r.status_code == 200, r.text
    cfg = r.json()["config"]["stages"]["rumble"]
    assert cfg == {"enabled": True, "cutoff_hz": 100.0, "order": 4}                          # order kept from DEFAULT_CONFIG
    y, _ = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{r.json()['job_id']}/download").content), dtype="float64")
    a = lambda s, f: 2 * np.abs(np.fft.rfft(s * np.hanning(s.size))[int(f * s.size / fs)]).max() / np.hanning(s.size).sum()
    assert a(y, 40) < 0.02 * a(x, 40)                                                        # rumble gone (> 34 dB)
    assert abs(a(y, 1000) / a(x, 1000) - 1) < 0.01                                           # speech tone kept


def test_filter_order_rejects_booleans_and_long_cutoff_lists():
    aid = _upload(tone(440, FS, 1.0, 0.3))
    assert c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "order": True, "cutoff_hz": [1000]}).status_code == 422
    assert c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "cutoff_hz": [1.0] * 100000}).status_code == 422


# ---------------------------------------------------------------- error leakage
def test_unexpected_decode_failure_does_not_leak_exception_text(monkeypatch):
    def boom(_):
        raise RuntimeError("secret internal path /srv/private/keys.pem")
    monkeypatch.setattr(routes.audio_io, "decode_audio", boom)
    r = c.post("/api/v1/audio/upload", files={"file": ("a.wav", _wav(tone(440, FS, 0.5)), "audio/wav")})
    assert r.status_code == 500 and "secret" not in r.text and "/srv" not in r.text and "error id" in r.json()["detail"]


def test_unhandled_error_returns_generic_500_without_trace(monkeypatch):
    aid = _upload(tone(440, FS, 1.0))
    monkeypatch.setattr(routes.st, "audio_statistics", lambda *a, **k: (_ for _ in ()).throw(ValueError("db password is hunter2")))
    r = c.get(f"/api/v1/audio/{aid}/summary")
    assert r.status_code == 500 and "hunter2" not in r.text and "Traceback" not in r.text and "error id" in r.json()["detail"]


# ---------------------------------------------------------------- request-size guard (rejects before the body is parsed/spooled)
def test_oversized_requests_are_rejected_with_413_before_parsing(monkeypatch):
    monkeypatch.setattr(app_main, "settings", types.SimpleNamespace(max_file_bytes=1000, upload_overhead_bytes=100, max_json_body_bytes=500,
                                                                  cors_origins=("http://localhost:5173",)))
    r = c.post("/api/v1/audio/upload", files={"file": ("a.wav", b"RIFF" + b"\0" * 5000, "audio/wav")})
    assert r.status_code == 413
    r = c.post("/api/v1/clearvoice/x/filter", content=b"{" + b" " * 2000 + b"}", headers={"content-type": "application/json"})
    assert r.status_code == 413
    r = c.post("/api/v1/clearvoice/x/filter", content=b"{}", headers={"content-type": "application/json", "content-length": "not-a-number"})
    assert r.status_code in (400, 413)                                                      # malformed header never reaches a handler


# ---------------------------------------------------------------- store memory budget
@pytest.fixture
def small_store(monkeypatch):
    saved = dict(store._items)
    store._items.clear()
    monkeypatch.setattr(store, "settings", types.SimpleNamespace(max_items=50, max_store_bytes=1_000_000, ttl_seconds=3600))
    yield
    store._items.clear(); store._items.update(saved)


def test_store_evicts_least_recently_used_when_over_memory_budget(small_store):
    a = store.put("audio", {"x": np.zeros(40_000)})          # 320 kB
    b = store.put("audio", {"x": np.zeros(40_000)})
    assert store.get(a, "audio") is not None                 # touching a makes b the least recently used
    cc = store.put("audio", {"x": np.zeros(40_000)})         # 960 kB total: fits
    d = store.put("audio", {"x": np.zeros(40_000)})          # would be 1.28 MB: evict LRU (= b)
    assert store.get(b, "audio") is None
    assert all(store.get(k, "audio") is not None for k in (a, cc, d))
    assert store.stats()["bytes"] <= 1_000_000


def test_store_counts_shared_arrays_once_and_never_evicts_the_new_item(small_store):
    shared = np.zeros(60_000)                                 # 480 kB referenced by two items (as a job references its upload)
    a = store.put("audio", {"x": shared})
    j = store.put("job", {"x": shared, "y": np.zeros(10_000)})
    assert store.get(a, "audio") is not None and store.get(j, "job") is not None      # 560 kB counted, not 1.04 MB
    big = store.put("audio", {"x": np.zeros(500_000)})        # 4 MB alone exceeds the budget: accepted, everything else evicted
    assert store.get(big, "audio") is not None and store.get(a, "audio") is None and store.get(j, "job") is None


def test_job_stores_processed_signal_once_as_float32_and_downloads_are_identical():
    """Before: float64 y + float32 WAV bytes + eager 16-bit WAV per job (~14 B/sample/channel). After: float32 y only (4 B)."""
    x = tone(440, FS, 2.0, 0.5)
    aid = _upload(x)
    r = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "order": 4, "cutoff_hz": [2000], "method": "causal"})
    job = r.json()["job_id"]
    stored = store.get(job, "job")
    assert stored["y"].dtype == np.float32 and "wav" not in stored and "wav_pcm16" not in stored
    f32 = sf.read(io.BytesIO(c.get(f"/api/v1/clearvoice/{job}/download").content), dtype="float32")[0]
    assert np.array_equal(f32, stored["y"][0])                                                  # float32 download is bit-identical to the stored signal
    p16 = c.get(f"/api/v1/clearvoice/{job}/download?subtype=pcm16")
    assert p16.status_code == 200
    y16 = sf.read(io.BytesIO(p16.content), dtype="float64")[0]
    assert np.max(np.abs(y16 - stored["y"][0].astype(np.float64))) <= 0.5 / 32768 + 1e-9        # quantisation error only


# ---------------------------------------------------------------- concurrency gate
def test_busy_server_answers_503_with_retry_after_then_recovers(monkeypatch):
    aid = _upload(tone(440, FS, 1.0))
    sem = threading.BoundedSemaphore(1)
    monkeypatch.setattr(limits, "_sem", sem)
    monkeypatch.setattr(limits, "settings", types.SimpleNamespace(queue_timeout_s=0.2, max_concurrent=1))
    assert sem.acquire(timeout=1)                             # another request is holding the only processing slot
    try:
        r = c.post(f"/api/v1/clearvoice/{aid}/analyze", json={})
        assert r.status_code == 503 and r.headers["retry-after"] == "5"
        r = c.post("/api/v1/audio/upload", files={"file": ("a.wav", _wav(tone(440, FS, 0.5)), "audio/wav")})
        assert r.status_code == 503                           # the upload decode is gated too
    finally:
        sem.release()
    assert c.post(f"/api/v1/clearvoice/{aid}/analyze", json={}).status_code == 200          # slot free again
    assert sem.acquire(timeout=1); sem.release()               # and the slot was released after the request (no leak)


def test_slot_is_released_when_processing_fails(monkeypatch):
    aid = _upload(tone(440, FS, 1.0))
    sem = threading.BoundedSemaphore(1)
    monkeypatch.setattr(limits, "_sem", sem)
    r = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "lowpass", "cutoff_hz": [99999]})   # 422 from the DSP validation
    assert r.status_code == 422
    assert sem.acquire(timeout=1); sem.release()
