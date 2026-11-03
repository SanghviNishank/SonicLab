"""Before-vs-after studio measurements, loudness-matched download and the automatic processing report (real jobs through the API)."""
import io
import numpy as np
import soundfile as sf
import pytest
from fastapi.testclient import TestClient

from app.main import app
from synth import tone

c = TestClient(app)
FS = 16000


def _upload(x, name="clip.wav"):
    b = io.BytesIO(); sf.write(b, x, FS, format="WAV", subtype="FLOAT")
    r = c.post("/api/v1/audio/upload", files={"file": (name, b.getvalue(), "audio/wav")}); assert r.status_code == 200, r.text
    return r.json()["metadata"]["audio_id"], len(b.getvalue())


def _speech_like():
    t = np.arange(FS * 2) / FS
    return 0.4 * np.sin(2 * np.pi * 1000 * t) + 0.3 * np.sin(2 * np.pi * 50 * t)          # 1 kHz "voice" + 50 Hz rumble


@pytest.fixture(scope="module")
def job():
    x = _speech_like(); aid, size = _upload(x, "my rec.wav")
    r = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "highpass", "order": 4, "cutoff_hz": [200], "method": "zero_phase"}); assert r.status_code == 200, r.text
    return {"x": x, "aid": aid, "size": size, "job": r.json()["job_id"], "resp": r.json()}


def _wav(job_id, q=""):
    r = c.get(f"/api/v1/clearvoice/{job_id}/download{q}"); assert r.status_code == 200, r.text
    y, fs = sf.read(io.BytesIO(r.content), dtype="float64"); return y, fs


def test_levels_match_independent_numpy_measurements(job):
    lv = c.get(f"/api/v1/clearvoice/{job['job']}/levels").json()
    y, _ = _wav(job["job"]); x = job["x"]
    assert lv["original"]["channels"][0]["rms"] == pytest.approx(np.sqrt(np.mean(x ** 2)), rel=1e-9)
    assert lv["processed"]["channels"][0]["rms"] == pytest.approx(np.sqrt(np.mean(y ** 2)), rel=1e-6)
    assert lv["processed"]["channels"][0]["peak"] == pytest.approx(np.max(np.abs(y)), rel=1e-6)
    assert lv["same_length"] and lv["duration_difference_s"] == 0
    assert lv["processed"]["channels"][0]["rms"] < lv["original"]["channels"][0]["rms"]      # rumble was removed -> less energy
    d = lv["waveform_difference"]["channels"][0]
    assert len(d["t"]) == len(d["y"]) > 10 and max(abs(v) for v in d["y"]) > 0.2                # the removed 50 Hz component is visible


def test_loudness_matched_download_has_original_rms_and_leaves_stored_audio_unchanged(job):
    plain, _ = _wav(job["job"]); matched, fs = _wav(job["job"], "?match_loudness=true")
    assert fs == FS and matched.shape == plain.shape
    assert np.sqrt(np.mean(matched ** 2)) == pytest.approx(np.sqrt(np.mean(job["x"] ** 2)), rel=1e-5)
    assert not np.allclose(matched, plain)
    again, _ = _wav(job["job"]); assert np.array_equal(again, plain)                           # matching never modifies the stored result
    lv = c.get(f"/api/v1/clearvoice/{job['job']}/levels").json()
    assert lv["loudness_match_gain_db"] == pytest.approx(20 * np.log10(np.sqrt(np.mean(job["x"] ** 2)) / np.sqrt(np.mean(plain ** 2))), abs=1e-4)


def test_levels_report_clipping_and_warn_when_matching_would_clip():
    x = 0.9 * np.sin(2 * np.pi * 300 * np.arange(FS) / FS)
    x[:50] = 1.0                                                                                # 50 samples at full scale
    aid, _ = _upload(x)
    j = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": "bandpass", "order": 2, "cutoff_hz": [250, 350], "method": "causal"}).json()["job_id"]
    lv = c.get(f"/api/v1/clearvoice/{j}/levels").json()
    assert lv["original"]["channels"][0]["clipped_samples"] >= 50 and lv["processed"]["channels"][0]["clipped_samples"] < lv["original"]["channels"][0]["clipped_samples"]
    assert any('clipped' in n.lower() or 'Clipped' in n for n in lv['notes'])


def test_loudness_match_refused_for_silent_processed_audio():
    from app.services import studio
    assert studio.match_gain_db(np.ones((1, 100)), np.zeros((1, 100))) is None and studio.match_gain_db(np.zeros((1, 100)), np.ones((1, 100))) is None
    assert studio.match_gain_db(np.ones((1, 100)), 0.5 * np.ones((1, 100))) == pytest.approx(6.0206, abs=1e-3)


def test_unknown_job_is_404_for_new_endpoints():
    for p in ("levels", "processing-report", "report?format=pdf", "report?format=summary"):
        assert c.get(f"/api/v1/clearvoice/nope/{p}").status_code == 404


def test_processing_report_uses_actual_settings_and_measurements(job):
    r = c.get(f"/api/v1/clearvoice/{job['job']}/processing-report").json()
    rec, pr = r["recording"], r["processing"]
    assert rec["filename"] == "my rec.wav" and rec["sample_rate_hz"] == FS and rec["channels"] == 1 and rec["file_size_bytes"] == job["size"]
    assert pr["config"]["filter_type"] == "highpass" and pr["config"]["cutoff_hz"] == [200.0] and pr["config"]["order"] == 4 and pr["config"]["method"] == "zero_phase"
    assert pr["processing_s"] == pytest.approx(job["resp"]["processing_s"], abs=0.5) and pr["processing_s"] > 0
    assert pr["noise_reduction"]["applied"] is False
    assert r["analysis"]["dominant_peaks_original"] and abs(r["analysis"]["dominant_peaks_original"][0]["frequency_hz"] - 1000) < 1
    cm = r["comparison"]["per_channel"][0]
    assert cm["rms_before"] == pytest.approx(np.sqrt(np.mean(job["x"] ** 2)), rel=1e-9) and cm["rms_after"] < cm["rms_before"]
    assert "high-pass" in r["explanation"] and "200 Hz" in r["explanation"] and "order 4" in r["explanation"] and "zero-phase" in r["explanation"].lower()
    assert any("SNR" in l for l in r["limitations"]) and all(k in r["software"] for k in ("app_version", "numpy", "scipy", "python"))
    assert "improv" not in r["explanation"].lower().replace("judged by listening", "")            # no claimed improvement
    assert r["reproducibility"]["parameters"] == pr["config"]


def test_explanation_follows_the_filter_type():
    aid, _ = _upload(_speech_like())
    for ft, cut, word in [("lowpass", [3000], "low-pass"), ("bandpass", [300, 3400], "band-pass"), ("bandstop", [900, 1100], "band-stop")]:
        j = c.post(f"/api/v1/clearvoice/{aid}/filter", json={"filter_type": ft, "order": 3, "cutoff_hz": cut, "method": "causal"}).json()["job_id"]
        e = c.get(f"/api/v1/clearvoice/{j}/processing-report").json()["explanation"]
        assert word in e and f"{cut[0]:g} Hz" in e and "Causal" in e


def test_report_exports_pdf_html_and_summary(job):
    pdf = c.get(f"/api/v1/clearvoice/{job['job']}/report?format=pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"] == "application/pdf" and pdf.content[:5] == b"%PDF-" and pdf.content.rstrip().endswith(b"%%EOF") and len(pdf.content) > 5000
    try:
        import pypdf
        text = "".join(p.extract_text() for p in pypdf.PdfReader(io.BytesIO(pdf.content)).pages)
        assert "Recording information" in text and "highpass" in text and "Limitations" in text and "my rec.wav" in text
    except ImportError:
        pass
    html = c.get(f"/api/v1/clearvoice/{job['job']}/report?format=html").text
    assert "5. Processing explanation" in html and "6. Limitations" in html and "highpass" in html
    md = c.get(f"/api/v1/clearvoice/{job['job']}/report?format=summary")
    assert md.status_code == 200 and "attachment" in md.headers["content-disposition"] and "highpass" in md.text and "RMS" in md.text
    assert c.get(f"/api/v1/clearvoice/{job['job']}/report?format=docx").status_code == 422


def test_voice_job_report_lists_noise_reduction_settings():
    aid, _ = _upload(0.2 * np.sin(2 * np.pi * 440 * np.arange(FS * 3) / FS) + 0.03 * np.random.default_rng(1).standard_normal(FS * 3))
    r = c.post(f"/api/v1/clearvoice/{aid}/voice", json={"preset": "lecture_speech"}); assert r.status_code == 200, r.text
    rep = c.get(f"/api/v1/clearvoice/{r.json()['job_id']}/processing-report").json()
    assert rep["processing"]["kind"] == "voice" and rep["processing"]["processing_s"] > 0
    assert "voice-enhancement pipeline" in rep["explanation"]
    assert c.get(f"/api/v1/clearvoice/{r.json()['job_id']}/report?format=pdf").content[:5] == b"%PDF-"


def test_preview_response_is_identical_to_the_response_returned_with_the_processed_audio():
    """Visual Filter Lab promise: the theoretical preview and the actual backend filter are the same design on the same frequency grid
    (found in the browser: different grid sizes made the two curves differ by 0.5 dB between samples on a steep slope)."""
    import io, numpy as np, soundfile as sf
    from fastapi.testclient import TestClient
    from app.main import app
    from synth import tone
    c = TestClient(app)
    b = io.BytesIO(); sf.write(b, tone(440, 16000, 1.0, 0.3), 16000, format="WAV", subtype="FLOAT")
    aid = c.post("/api/v1/audio/upload", files={"file": ("a.wav", b.getvalue(), "audio/wav")}).json()["metadata"]["audio_id"]
    for body in ({"filter_type": "highpass", "order": 4, "cutoff_hz": [400], "method": "zero_phase"},
                 {"filter_type": "bandstop", "order": 6, "cutoff_hz": [950, 1050], "method": "causal"}):
        p = c.post(f"/api/v1/clearvoice/{aid}/filter/preview", json=body).json()["response"]
        r = c.post(f"/api/v1/clearvoice/{aid}/filter", json=body).json()["response"]
        assert np.array_equal(p["freqs_hz"], r["freqs_hz"])
        assert np.max(np.abs(np.array(p["magnitude_db"]) - np.array(r["magnitude_db"]))) < 1e-9
