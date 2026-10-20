import subprocess, tempfile, os
import numpy as np
import pytest
from app.processing import fft_analysis as fa, comparison as cmp, voice as vc
from app.processing.siren_features import extract_features
from app.processing.siren_detector import detect_candidate_sirens, DetectorConfig
from app.services import report_builders as rb, reports
from synth import speech_like, noise, siren

FS = 16000

def cv_job(name="a.wav"):
    sp = speech_like(FS, 2.0); x = np.atleast_2d(np.concatenate([np.zeros(int(0.5 * FS)), sp]) + noise(int(2.5 * FS), 1, 0.03))
    r = vc.run_voice_pipeline(x, FS, "speech_clarity")
    s0 = fa.single_sided_spectrum(x[0], FS); s1 = fa.single_sided_spectrum(r["output"][0], FS)
    sp_ = lambda s: {"freqs_hz": s["freqs_hz"], "amplitude": s["amplitude"], "peaks": fa.find_spectral_peaks(s["freqs_hz"], s["amplitude"])}
    meta = {"sample_rate_hz": FS, "channels": 1, "duration_s": x.shape[1] / FS, "samples_per_channel": x.shape[1], "source_format": "wav", "sample_format": "WAV/float64"}
    return {"x": x, "y": r["output"], "fs": FS, "config": {"pipeline": "voice", "preset": "speech_clarity", "engine": "python-scipy"},
            "metrics": cmp.compare_signals(x, r["output"]), "warnings": r["warnings"], "history": r["history"], "quality": r["quality"],
            "before": sp_(s0), "after": sp_(s1), "meta": meta, "name": name}, r

def rs_job():
    x = np.concatenate([np.zeros(FS * 2), siren(FS, 4.0), np.zeros(FS * 2)])
    f = extract_features(x, FS); res = detect_candidate_sirens(f, DetectorConfig())
    meta = {"sample_rate_hz": FS, "channels": 1, "duration_s": 8.0, "source_format": "wav"}
    return {"mono": x, "fs": FS, "feat": f, "events": res["events"], "meta": meta, "name": "t.wav",
            "config": {"detector": res["config"], "features": f["meta"], "preprocessing": [{"step": "mono_mix", "detail": "single channel"}]}}

def test_clearvoice_html_contains_real_values_and_history():
    job, r = cv_job(); h = reports.to_html(rb.clearvoice_report(job))
    assert "ClearVoice analysis report" in h and "16000" in h and "noise_reduction" in h and "rumble_highpass" in h
    assert f"{job['metrics']['per_channel'][0]['mse']:.4g}" in h                       # actual MSE appears
    assert "data:image/png;base64" in h and "not a quality or denoising score" in h

def test_html_escapes_untrusted_filename():
    job, _ = cv_job('<script>alert(1)</script>.wav'); h = reports.to_html(rb.clearvoice_report(job, with_plots=False))
    assert "<script>alert" not in h and "&lt;script&gt;" in h

def test_clearvoice_pdf_is_valid_and_contains_text():
    job, _ = cv_job(); pdf = reports.to_pdf(rb.clearvoice_report(job))
    assert pdf[:5] == b"%PDF-" and len(pdf) > 5000
    with tempfile.TemporaryDirectory() as d:
        p = os.path.join(d, "r.pdf"); open(p, "wb").write(pdf)
        try: txt = subprocess.run(["pdftotext", p, "-"], capture_output=True, text=True, check=True).stdout
        except FileNotFoundError: pytest.skip("pdftotext not installed")
    assert "ClearVoice analysis report" in txt and "Processing history" in txt and "speech_clarity" in txt

def test_pdf_handles_many_rows_page_breaks():
    m = rb.clearvoice_report(cv_job()[0], with_plots=False)
    m["sections"].append({"heading": "Big", "paragraphs": [], "table": {"columns": ["a", "b"], "rows": [[str(i), "x" * 40] for i in range(400)]}})
    pdf = reports.to_pdf(m)
    from pypdf import PdfReader
    import io
    assert len(PdfReader(io.BytesIO(pdf)).pages) >= 4

def test_roadsonic_report_lists_only_detected_events_with_disclaimer():
    job = rs_job(); m = rb.roadsonic_report(job); h = reports.to_html(m)
    assert len(job["events"]) == 1 and "CANDIDATE siren events" in h and "not a safety-critical" in h
    assert f"{job['events'][0]['start_s']:.5g}" in h and "not a calibrated probability" in h
    pdf = reports.to_pdf(m); assert pdf[:5] == b"%PDF-"

def test_roadsonic_report_empty_state_does_not_invent_events():
    job = rs_job(); job["events"] = []; h = reports.to_html(rb.roadsonic_report(job, with_plots=False))
    assert "(0)" in h and "does not prove that no siren" in h and "Start (s)" not in h

def test_pdf_without_reportlab_gives_clear_error(monkeypatch=None):
    import sys, builtins
    real = builtins.__import__
    def fake(name, *a, **k):
        if name.startswith("reportlab"): raise ImportError
        return real(name, *a, **k)
    builtins.__import__ = fake
    try:
        with pytest.raises(RuntimeError) as e: reports.to_pdf({"title": "t", "subtitle": "", "generated": "", "sections": []})
        assert "reportlab" in str(e.value)
    finally: builtins.__import__ = real


def test_store_summaries_hide_arrays_and_delete_works():
    from app.services import store
    jid = store.put("job", {"x": np.zeros(10), "name": "a.wav", "config": {"k": 1}, "warnings": ["w"]})
    aid = store.put("audio", {"x": np.zeros(10)})
    items = store.list_summaries()
    mine = [i for i in items if i["job_id"] == jid][0]
    assert mine["input_label"] == "a.wav" and "x" not in mine and all(i["job_id"] != aid for i in items)
    store.delete(jid); assert store.get(jid, "job") is None

def test_store_ttl_expiry():
    from app.services import store
    jid = store.put("job", {"name": "t"})
    store._items[jid]["t"] -= 10 ** 6
    assert store.get(jid, "job") is None
