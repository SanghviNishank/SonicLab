from __future__ import annotations
import csv, io, json, logging, time
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.config import settings
from app.processing import audio_io, statistics as st, fft_analysis as fa, spectrogram as sg
from app.processing import filters as flt, comparison as cmp, voice as vc
from app.processing.siren_features import extract_features
from app.processing.siren_detector import DetectorConfig, detect_candidate_sirens
from app.matlab import engine_adapter
from app.services import store, reports, report_builders as rb

logger = logging.getLogger("signalsystem.api")

router = APIRouter(prefix="/api/v1")
_MIME = {"wav": "audio/wav", "flac": "audio/flac", "ogg": "audio/ogg", "mp3": "audio/mpeg", "m4a": "audio/mp4", "aac": "audio/aac", "aiff": "audio/aiff"}


def _audio(audio_id: str) -> dict:
    a = store.get(audio_id, "audio")
    if a is None:
        raise HTTPException(404, "audio not found or expired; please upload again")
    return a

def _wave_payload(x2: np.ndarray, fs: float, max_points: int = 4000) -> dict:
    out = []
    for c in x2:
        i, v = st.downsample_minmax(c, max_points)
        out.append({"t": (i / fs).tolist(), "y": v.tolist()})
    return {"display_only": True, "channels": out}

def _csv(rows: list[dict]) -> str:
    buf = io.StringIO()
    if rows:
        w = csv.DictWriter(buf, fieldnames=list(rows[0].keys())); w.writeheader(); w.writerows(rows)
    return buf.getvalue()

def _downsample_spec(freqs, amp, max_points=6000):
    if freqs.size <= max_points:
        return freqs, amp
    idx = np.unique(np.linspace(0, freqs.size - 1, max_points).astype(int))
    return freqs[idx], amp[idx]


@router.get("/health")
def health():
    return {"status": "ok", "audio_io": audio_io.capabilities(), "engine": "python-scipy", "matlab": engine_adapter.status(),
            "limits": {"max_file_mb": settings.max_file_bytes // 2**20, "max_duration_s": settings.max_duration_s}}


@router.post("/audio/upload")
async def upload(file: UploadFile = File(...)):
    data = await file.read(settings.max_file_bytes + 1)
    try:
        dec = audio_io.decode_audio(data)
    except audio_io.AudioError as e:
        logger.warning("Audio upload rejected for '%s': %s", file.filename, e)
        raise HTTPException(422, str(e))
    except Exception as e:
        logger.error("Audio upload failed unexpectedly for '%s': %s", file.filename, e, exc_info=True)
        raise HTTPException(500, f"Error processing audio upload: {e}")
    x, fs = dec["samples"], dec["sample_rate"]
    audio_id = store.put("audio", {"x": x, "fs": fs, "wav": data, "subtype": dec["subtype"], "source_format": dec["source_format"],
                                "name": (file.filename or "unnamed")[:120]})
    meta = {"audio_id": audio_id, "sample_rate_hz": fs, "channels": x.shape[0], "samples_per_channel": x.shape[1],
            "duration_s": x.shape[1] / fs, "sample_format": dec["subtype"], "decoded_dtype": "float64",
            "source_format": dec["source_format"], "decoder_warnings": dec["warnings"]}
    a = store.get(audio_id, "audio"); a["meta"] = meta
    return {"metadata": meta, "statistics": st.audio_statistics(x, fs), "waveform": _wave_payload(x, fs)}


@router.get("/audio/{audio_id}/file")
def original_file(audio_id: str):
    a = _audio(audio_id)
    return Response(a["wav"], media_type=_MIME.get(a["source_format"], "application/octet-stream"),
                    headers={"Content-Disposition": f'attachment; filename="original.{a["source_format"]}"'})


class AnalyzeReq(BaseModel):
    window: str = Field("hann", pattern="^(hann|rect)$")
    n_fft: int | None = Field(None, ge=2, le=fa.MAX_NFFT)
    channel: int = Field(0, ge=0, le=1)
    frame_length: int = Field(1024, ge=8, le=65536)
    hop_length: int | None = Field(None, ge=1)
    compare_windows: bool = False

def _analysis(x2, fs, req: AnalyzeReq) -> dict:
    if req.channel >= x2.shape[0]:
        raise HTTPException(422, "channel index out of range")
    ch = x2[req.channel]
    sp, spec_engine = engine_adapter.single_sided_spectrum(ch, fs, req.window, req.n_fft)
    f, a = _downsample_spec(sp["freqs_hz"], sp["amplitude"])
    out = {"channel": req.channel, "engine": spec_engine,
           "spectrum": {"freqs_hz": f.tolist(), "amplitude": a.tolist(), "window": sp["window"], "n_fft": sp["n_fft"],
                        "bin_spacing_hz": sp["bin_spacing_hz"], "nominal_resolution_hz": sp["nominal_resolution_hz"],
                        "amplitude_unit": sp["amplitude_unit"],
                        "peaks": fa.find_spectral_peaks(sp["freqs_hz"], sp["amplitude"])}}
    if req.compare_windows:
        other = "rect" if req.window == "hann" else "hann"
        o = fa.single_sided_spectrum(ch, fs, other, req.n_fft)
        fo, ao = _downsample_spec(o["freqs_hz"], o["amplitude"])
        out["spectrum_other_window"] = {"window": other, "freqs_hz": fo.tolist(), "amplitude": ao.tolist()}
    S = sg.stft_db(ch, fs, req.frame_length, req.hop_length, req.window)
    db = S["magnitude_db"]
    step_t = max(1, db.shape[1] // 400); step_f = max(1, db.shape[0] // 256)   # display decimation only
    out["spectrogram"] = {"times_s": S["times_s"][::step_t].tolist(), "freqs_hz": S["freqs_hz"][::step_f].tolist(),
                          "magnitude_db": np.round(db[::step_f, ::step_t], 1).tolist(),
                          "reference": S["reference"], "frame_length": S["frame_length"], "hop_length": S["hop_length"]}
    return out


@router.post("/clearvoice/{audio_id}/analyze")
def analyze(audio_id: str, req: AnalyzeReq):
    a = _audio(audio_id)
    try:
        return _analysis(a["x"], a["fs"], req)
    except engine_adapter.EngineError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))


class FilterReq(BaseModel):
    filter_type: str
    order: int = 4
    cutoff_hz: list[float]
    method: str = "zero_phase"
    analysis: AnalyzeReq = AnalyzeReq()


@router.post("/clearvoice/{audio_id}/filter")
def filter_audio(audio_id: str, req: FilterReq):
    a = _audio(audio_id)
    x, fs = a["x"], a["fs"]
    try:
        r = flt.run_filter(x, fs, req.filter_type, req.order, req.cutoff_hz, req.method)
        y = r["output"]
        metrics = cmp.compare_signals(x, y)
        before = _analysis(x, fs, req.analysis)
        after = _analysis(y, fs, req.analysis)
    except (flt.FilterError, ValueError) as e:
        raise HTTPException(422, str(e))
    resp = r["response"]
    sub = np.unique(np.linspace(0, resp["freqs_hz"].size - 1, 600).astype(int))
    job = store.put("job", {"y": y, "fs": fs, "meta": a["meta"], "name": a["name"], "created": time.time(), "audio_id": audio_id,
                            "config": r["config"], "metrics": metrics, "warnings": r["warnings"],
                            "wav": audio_io.encode_wav(y, fs, "float32")[0], "x": x,
                            "wav_pcm16": audio_io.encode_wav(y, fs, "pcm16"), "before": before["spectrum"], "after": after["spectrum"]})
    return {"job_id": job, "config": r["config"], "warnings": r["warnings"], "metrics": metrics,
            "response": {"freqs_hz": resp["freqs_hz"][sub].tolist(), "magnitude_db": resp["magnitude_db"][sub].tolist(),
                         "effective": resp["effective"]},
            "waveform_original": _wave_payload(x, fs), "waveform_filtered": _wave_payload(y, fs),
            "spectrum_original": before["spectrum"], "spectrum_filtered": after["spectrum"],
            "spectrogram_original": before["spectrogram"], "spectrogram_filtered": after["spectrogram"],
            "wav_format": "32-bit float WAV, no clipping or normalisation applied"}


class VoiceReq(BaseModel):
    preset: str | None = "speech_clarity"
    overrides: dict = {}
    analysis: AnalyzeReq = AnalyzeReq()


@router.get("/clearvoice/presets")
def presets():
    return {"presets": {k: v["description"] for k, v in vc.PRESETS.items()}, "defaults": vc.DEFAULT_CONFIG,
            "notes": "A filter is not a denoiser. Presets are fixed parameter sets, not guarantees; quality is not verified for natural speech."}


@router.post("/clearvoice/{audio_id}/voice")
def voice(audio_id: str, req: VoiceReq):
    a = _audio(audio_id)
    x, fs = a["x"], a["fs"]
    try:
        r = vc.run_voice_pipeline(x, fs, req.preset, req.overrides)
        y = r["output"]
        metrics = cmp.compare_signals(x, y)
        before = _analysis(x, fs, req.analysis); after = _analysis(y, fs, req.analysis)
    except ValueError as e:                                   # includes FilterError
        raise HTTPException(422, str(e))
    cfg = {"pipeline": "voice", "preset": r["preset"], "stages": r["config"], "sample_rate": float(fs), "engine": r["engine"]}
    job = store.put("job", {"y": y, "x": x, "fs": fs, "meta": a["meta"], "name": a["name"], "created": time.time(), "audio_id": audio_id, "config": cfg, "metrics": metrics, "warnings": r["warnings"],
                            "history": r["history"], "quality": r["quality"],
                            "wav": audio_io.encode_wav(y, fs, "float32")[0], "wav_pcm16": audio_io.encode_wav(y, fs, "pcm16"),
                            "before": before["spectrum"], "after": after["spectrum"]})
    return {"job_id": job, "config": cfg, "history": r["history"], "quality": r["quality"], "warnings": r["warnings"],
            "metrics": metrics, "bypass_note": "Compare against the original with the A/B players; the original is never modified.",
            "waveform_original": _wave_payload(x, fs), "waveform_filtered": _wave_payload(y, fs),
            "spectrum_original": before["spectrum"], "spectrum_filtered": after["spectrum"],
            "spectrogram_original": before["spectrogram"], "spectrogram_filtered": after["spectrogram"],
            "wav_format": "float32 WAV by default; ?subtype=pcm16 for the most compatible 16-bit file (refused if it would clip)"}


def _job(job_id: str) -> dict:
    j = store.get(job_id, "job")
    if j is None:
        raise HTTPException(404, "download expired or not found; run the processing again")
    return j


@router.get("/clearvoice/{job_id}/download")
def download(job_id: str, subtype: str = "float32"):
    j = _job(job_id)
    if subtype == "float32": body = j["wav"]
    elif subtype == "pcm16":
        body, info = j["wav_pcm16"]
        if info["clipped_samples"]:
            raise HTTPException(409, f"PCM16 export would clip {info['clipped_samples']} samples; download float32 instead")
    else: raise HTTPException(422, "subtype must be float32 or pcm16")
    return Response(body, media_type="audio/wav",
                    headers={"Content-Disposition": 'attachment; filename="clearvoice_filtered.wav"'})


@router.get("/clearvoice/{job_id}/export")
def export(job_id: str, kind: str = "metadata", channel: int = 0, frame_length: int = 1024, hop_length: int = 512):
    j = _job(job_id)
    if kind == "metadata":
        return Response(json.dumps({"config": j["config"], "metrics": j["metrics"], "warnings": j["warnings"]}, indent=2),
                        media_type="application/json", headers={"Content-Disposition": 'attachment; filename="clearvoice_metadata.json"'})
    if kind in ("spectrum_original", "spectrum_filtered"):
        s = j["before" if kind.endswith("original") else "after"]
        rows = [{"freq_hz": f, "amplitude": a} for f, a in zip(s["freqs_hz"], s["amplitude"])]
        return Response(_csv(rows), media_type="text/csv", headers={"Content-Disposition": f'attachment; filename="{kind}.csv"'})
    if kind == "history":
        return Response(json.dumps({"config": j["config"], "history": j.get("history", []), "quality": j.get("quality")}, indent=2),
                        media_type="application/json", headers={"Content-Disposition": 'attachment; filename="processing_history.json"'})
    if kind in ("spectrogram_original", "spectrogram_filtered"):
        sig = j["x"] if kind.endswith("original") else j["y"]
        if not 0 <= channel < sig.shape[0]:
            raise HTTPException(422, "channel out of range")
        try:
            S = sg.stft_db(sig[channel], j["fs"], frame_length, hop_length)
        except ValueError as e:
            raise HTTPException(422, str(e))
        n_cells = S["magnitude_db"].size
        if n_cells > 3_000_000:
            raise HTTPException(413, f"spectrogram has {n_cells} cells (limit 3,000,000); increase hop_length")
        hdr = ["# rows = time frames (centre time, s); columns = frequency bins (Hz); values = dB re full-scale single-sided amplitude",
               f"# frame_length={S['frame_length']} hop_length={S['hop_length']} window={S['window']} channel={channel}"]
        buf = io.StringIO(); buf.write("\n".join(hdr) + "\n")
        w = csv.writer(buf); w.writerow(["time_s"] + [f"{f:.3f}" for f in S["freqs_hz"]])
        for i, t in enumerate(S["times_s"]):
            w.writerow([f"{t:.6f}"] + [f"{v:.2f}" for v in S["magnitude_db"][:, i]])
        return Response(buf.getvalue(), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{kind}.csv"'})
    if kind == "metrics":
        rows = [{"channel": i, **m} for i, m in enumerate(j["metrics"]["per_channel"])]
        return Response(_csv(rows), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="metrics.csv"'})
    raise HTTPException(422, "kind must be metadata, history, metrics, spectrum_original/filtered or spectrogram_original/filtered")


class DetectReq(BaseModel):
    channel_mode: str = Field("mix", pattern="^(mix|0|1)$")
    remove_dc: bool = True
    band_lo: float = 450.0
    band_hi: float = 2000.0
    config: dict = {}


@router.post("/roadsonic/{audio_id}/detect")
def detect(audio_id: str, req: DetectReq):
    a = _audio(audio_id)
    x, fs = a["x"], a["fs"]
    steps = []
    if req.channel_mode == "mix":
        mono = x.mean(axis=0)
        steps.append({"step": "mono_mix", "detail": "channel average (may cancel out-of-phase content)" if x.shape[0] > 1 else "single channel"})
    else:
        if int(req.channel_mode) >= x.shape[0]:
            raise HTTPException(422, "channel out of range")
        mono = x[int(req.channel_mode)]
        steps.append({"step": "channel_select", "detail": req.channel_mode})
    if req.remove_dc:
        mono = mono - mono.mean(); steps.append({"step": "dc_removal", "detail": "subtract mean"})
    try:
        cfg = DetectorConfig(**req.config)
        feat = extract_features(mono, fs, band_lo=req.band_lo, band_hi=req.band_hi)
        res = detect_candidate_sirens(feat, cfg)
    except (TypeError, ValueError) as e:
        raise HTTPException(422, str(e))
    rows = [{k: float(feat[k][i]) for k in ("time_s", "rms_db", "centroid_hz", "bandwidth_hz", "dom_freq_hz", "tonal_ratio", "zcr")}
            for i in range(feat["time_s"].size)]
    ev_rows = [{"start_s": e["start_s"], "end_s": e["end_s"], "duration_s": e["duration_s"],
                "heuristic_score": e["heuristic_score"], **e["features"]} for e in res["events"]]
    S = sg.stft_db(mono, fs, 1024, 256)
    db = S["magnitude_db"]; st_t = max(1, db.shape[1] // 500); st_f = max(1, db.shape[0] // 200)
    spec = {"times_s": S["times_s"][::st_t].tolist(), "freqs_hz": S["freqs_hz"][::st_f].tolist(),
            "magnitude_db": np.round(db[::st_f, ::st_t], 1).tolist(), "reference": S["reference"],
            "note": "event times use the same seconds axis as the audio; frame centre = (m*hop + frame/2)/fs"}
    job = store.put("job", {"mono": mono, "fs": fs, "feat": feat, "meta": a["meta"], "name": a["name"], "created": time.time(),
                            "audio_id": audio_id, "events": res["events"], "ev_csv": _csv(ev_rows), "feat_csv": _csv(rows),
                            "config": {"detector": res["config"], "features": feat["meta"], "preprocessing": steps}})
    step = max(1, len(rows) // 1500)
    return {"job_id": job, "engine": "python-numpy/scipy", "preprocessing": steps, "events": res["events"],
            "config": {"detector": res["config"], "features": feat["meta"]}, "spectrogram": spec,
            "features": {k: [r[k] for r in rows[::step]] for k in rows[0]} if rows else {},
            "waveform": _wave_payload(x, fs),
            "disclaimer": "Academic prototype: candidate events are heuristic and NOT a safety-critical warning."}


@router.get("/roadsonic/{job_id}/export")
def rs_export(job_id: str, kind: str = "events_csv"):
    j = _job(job_id)
    m = {"events_csv": (j["ev_csv"], "text/csv", "events.csv"), "features_csv": (j["feat_csv"], "text/csv", "features.csv"),
         "events_json": (json.dumps(j["events"], indent=2), "application/json", "events.json"),
         "config_json": (json.dumps(j["config"], indent=2), "application/json", "detection_config.json")}
    if kind not in m:
        raise HTTPException(422, f"kind must be one of {list(m)}")
    body, mt, fn = m[kind]
    return Response(body, media_type=mt, headers={"Content-Disposition": f'attachment; filename="{fn}"'})


def _report_response(model_fn, job, fmt: str, base: str):
    try:
        model = model_fn(job)
        if fmt == "html":
            return Response(reports.to_html(model), media_type="text/html", headers={"Content-Disposition": f'attachment; filename="{base}.html"'})
        if fmt == "pdf":
            return Response(reports.to_pdf(model), media_type="application/pdf", headers={"Content-Disposition": f'attachment; filename="{base}.pdf"'})
    except RuntimeError as e:
        raise HTTPException(501, str(e))
    raise HTTPException(422, "format must be html or pdf")


@router.get("/clearvoice/{job_id}/report")
def clearvoice_report(job_id: str, format: str = "html"):
    return _report_response(rb.clearvoice_report, _job(job_id), format, "clearvoice_report")


@router.get("/roadsonic/{job_id}/report")
def roadsonic_report(job_id: str, format: str = "html"):
    j = _job(job_id)
    if "events" not in j:
        raise HTTPException(404, "not a RoadSonic job")
    return _report_response(rb.roadsonic_report, j, format, "roadsonic_report")


@router.get("/history")
def history():
    """Session-scoped list of processing results still held in memory (no raw samples)."""
    return {"items": store.list_summaries(), "note": "In-memory, cleared on restart or after the TTL; no database."}


@router.delete("/audio/{audio_id}")
def delete_audio(audio_id: str):
    if store.get(audio_id, "audio") is None:
        raise HTTPException(404, "audio not found or expired")
    store.delete(audio_id)
    return {"deleted": True}
