from __future__ import annotations
import csv, io, json, logging, time
import numpy as np
from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.config import settings
from app.processing import audio_io, statistics as st, fft_analysis as fa, spectrogram as sg
from app.processing import filters as flt, comparison as cmp, voice as vc
from app.matlab import engine_adapter
from app.services import store, reports, report_builders as rb, roadsonic as rsvc, metrics_service, engine_verification, siren_model
from app.schemas.roadsonic import DetectReq, EvaluateReq
from app.processing import enhance as enh
from app.processing.siren_detector import evaluate_events

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


@router.get("/audio/{audio_id}/summary")
def audio_summary(audio_id: str):
    """Rebuilds the upload response from the stored recording (used to restore a session after a page reload)."""
    a = _audio(audio_id)
    return {"metadata": a["meta"], "statistics": st.audio_statistics(a["x"], a["fs"]), "waveform": _wave_payload(a["x"], a["fs"]), "filename": a["name"]}


class RangeReq(BaseModel):
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)
    channel: int = Field(0, ge=0, le=1)


@router.post("/audio/{audio_id}/range-stats")
def range_stats(audio_id: str, req: RangeReq):
    a = _audio(audio_id)
    try:
        return st.range_statistics(a["x"], a["fs"], req.start_s, req.end_s, req.channel)
    except ValueError as e:
        raise HTTPException(422, str(e))


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
    sp, spec_info = engine_adapter.spectrum_info(ch, fs, req.window, req.n_fft)
    spec_engine = engine_adapter.engine_label(spec_info)
    f, a = _downsample_spec(sp["freqs_hz"], sp["amplitude"])
    out = {"channel": req.channel, "engine": spec_engine, "engine_info": spec_info,
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


class FilterPreviewReq(BaseModel):
    filter_type: str
    order: int = 4
    cutoff_hz: list[float] = Field(max_length=2)
    method: str = "zero_phase"


@router.post("/clearvoice/{audio_id}/filter/preview")
def filter_preview(audio_id: str, req: FilterPreviewReq):
    """Theoretical response of the designed filter for THIS recording's sample rate. No audio is processed."""
    a = _audio(audio_id)
    try:
        p = flt.preview_response(req.filter_type, req.order, req.cutoff_hz, a["fs"], req.method)
        fd, design_info = engine_adapter.filter_design_info(req.filter_type, req.order, req.cutoff_hz, a["fs"], req.method, 1024)
    except engine_adapter.EngineError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:                              # FilterError is a ValueError
        raise HTTPException(422, str(e))
    r = fd["response"]
    p["attenuation_at_cutoff"] = [{"frequency_hz": float(fc), "magnitude_db": float(r["magnitude_db"][int(np.argmin(np.abs(r["freqs_hz"] - fc)))])}
                                  for fc in req.cutoff_hz]
    sub = np.unique(np.linspace(0, r["freqs_hz"].size - 1, 600).astype(int))
    return {"settings": p["settings"], "attenuation_at_cutoff": p["attenuation_at_cutoff"], "explanation": p["explanation"],
            "response": {"freqs_hz": r["freqs_hz"][sub].tolist(), "magnitude_db": r["magnitude_db"][sub].tolist(), "effective": r["effective"]},
            "engine_info": design_info}


@router.post("/clearvoice/{audio_id}/filter")
def filter_audio(audio_id: str, req: FilterReq):
    a = _audio(audio_id)
    x, fs = a["x"], a["fs"]
    t_start = time.perf_counter()
    try:
        r = flt.run_filter(x, fs, req.filter_type, req.order, req.cutoff_hz, req.method)
        y = r["output"]
        metrics, metrics_info = metrics_service.compare_with_engine(x, y)
        before = _analysis(x, fs, req.analysis)
        after = _analysis(y, fs, req.analysis)
    except engine_adapter.EngineError as e:
        raise HTTPException(503, str(e))
    except (flt.FilterError, ValueError) as e:
        raise HTTPException(422, str(e))
    resp = r["response"]
    sub = np.unique(np.linspace(0, resp["freqs_hz"].size - 1, 600).astype(int))
    job = store.put("job", {"y": y, "fs": fs, "meta": a["meta"], "name": a["name"], "created": time.time(), "audio_id": audio_id,
                            "config": r["config"], "metrics": metrics, "warnings": r["warnings"],
                            "wav": audio_io.encode_wav(y, fs, "float32")[0], "x": x,
                            "wav_pcm16": audio_io.encode_wav(y, fs, "pcm16"), "before": before["spectrum"], "after": after["spectrum"]})
    return {"job_id": job, "processing_s": time.perf_counter() - t_start, "config": r["config"], "warnings": r["warnings"], "metrics": metrics, "metrics_engine_info": metrics_info,
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


@router.get("/clearvoice/{audio_id}/engine-verification")
def engine_verification_report(audio_id: str, channel: int = 0):
    """Runs spectrum, statistics, filter design and comparison through the configured engine AND Python on THIS
    recording and reports max |difference| vs tolerance. If MATLAB did not run, comparison_performed is false."""
    a = _audio(audio_id)
    if not 0 <= channel < a["x"].shape[0]:
        raise HTTPException(422, "channel index out of range")
    try:
        return engine_verification.verify_engines(a["x"][channel:channel + 1], a["fs"])
    except engine_adapter.EngineError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:
        raise HTTPException(422, str(e))


_siren_model = siren_model.SirenModelService()


@router.get("/roadsonic/model-status")
def roadsonic_model_status():
    """Readiness of the optional YAMNet+MLP scorer. It is NOT used by /roadsonic detection yet; the rule-based detector is
    the only detector wired into the API. `ready=false` always carries the reason."""
    return {**_siren_model.status(), "used_by_detection_endpoint": False,
            "note": "Frame/window scoring is implemented in app/services/siren_model.py but not yet validated on real recordings."}


@router.get("/clearvoice/presets")
def presets():
    return {"presets": {k: v["description"] for k, v in vc.PRESETS.items()}, "defaults": vc.DEFAULT_CONFIG,
            "notes": "A filter is not a denoiser. Presets are fixed parameter sets, not guarantees; quality is not verified for natural speech."}


@router.post("/clearvoice/{audio_id}/voice")
def voice(audio_id: str, req: VoiceReq):
    a = _audio(audio_id)
    x, fs = a["x"], a["fs"]
    t_start = time.perf_counter()
    try:
        r = vc.run_voice_pipeline(x, fs, req.preset, req.overrides)
        y = r["output"]
        metrics, metrics_info = metrics_service.compare_with_engine(x, y)
        before = _analysis(x, fs, req.analysis); after = _analysis(y, fs, req.analysis)
    except engine_adapter.EngineError as e:
        raise HTTPException(503, str(e))
    except ValueError as e:                                   # includes FilterError
        raise HTTPException(422, str(e))
    cfg = {"pipeline": "voice", "preset": r["preset"], "stages": r["config"], "sample_rate": float(fs), "engine": r["engine"]}
    job = store.put("job", {"y": y, "x": x, "fs": fs, "meta": a["meta"], "name": a["name"], "created": time.time(), "audio_id": audio_id, "config": cfg, "metrics": metrics, "warnings": r["warnings"],
                            "history": r["history"], "quality": r["quality"],
                            "wav": audio_io.encode_wav(y, fs, "float32")[0], "wav_pcm16": audio_io.encode_wav(y, fs, "pcm16"),
                            "before": before["spectrum"], "after": after["spectrum"]})
    return {"job_id": job, "processing_s": time.perf_counter() - t_start, "config": cfg, "history": r["history"], "quality": r["quality"], "warnings": r["warnings"],
            "metrics": metrics, "metrics_engine_info": metrics_info, "bypass_note": "Compare against the original with the A/B players; the original is never modified.",
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


# ------------------------------------------------------------------ RoadSonic
RS_FEATURE_COLS = ["time_s", "rms_db", "centroid_hz", "bandwidth_hz", "flatness", "dom_freq_hz", "peak_prominence_db", "tonal_ratio", "zcr"]


def _rs_job(job_id: str) -> dict:
    j = _job(job_id)
    if "events" not in j:
        raise HTTPException(404, "not a RoadSonic job")
    return j


@router.get("/roadsonic/defaults")
def rs_defaults():
    """Defaults, bounds, units and help text for every RoadSonic setting (single source of truth for the UI)."""
    return rsvc.defaults_payload()


def _version_payload(mono, fs, feat, events):
    return {"events": events, "tracks": rsvc.tracks_payload(feat), "n_events": len(events),
            "total_event_s": float(sum(e["duration_s"] for e in events))}


@router.post("/roadsonic/{audio_id}/detect")
def rs_detect(audio_id: str, req: DetectReq):
    a = _audio(audio_id)
    x, fs = a["x"], a["fs"]
    t_start = time.perf_counter()
    try:
        R = rsvc.run(x, fs, req)
        pre, active, use, chosen, main, other = R["pre"], R["active"], R["use"], R["chosen"], R["main"], R["other"]
        spec, sgram, sgram_orig = R["spectrum"], R["spectrogram"], R["spectrogram_original"]
    except (flt.FilterError, ValueError) as e:
        raise HTTPException(422, str(e))
    feat, events = main["feat"], main["events"]
    n = feat["time_s"].size
    rows = [{k: float(feat[k][i]) for k in RS_FEATURE_COLS} for i in range(n)]
    ev_rows = [{"start_s": e["start_s"], "end_s": e["end_s"], "duration_s": e["duration_s"], "label": e["label"],
                "heuristic_score": e["heuristic_score"], "pattern": e["trajectory"]["pattern"], **e["features"], "explanation": e["explanation"]}
               for e in events]
    steps = pre["steps"] + pre["processing_steps"]
    config = {"detector": main["detector"], "features": feat["meta"], "preprocessing": steps, "detect_on": use,
              "request": req.model_dump(), "engine": "python-numpy/scipy"}
    total = float(sum(e["duration_s"] for e in events))
    job = store.put("job", {"mono": chosen, "mono_original": pre["original"], "mono_processed": pre["processed"], "x": x, "fs": fs, "feat": feat,
                            "meta": a["meta"], "name": a["name"], "created": time.time(), "audio_id": audio_id, "events": events,
                            "ev_csv": _csv(ev_rows), "feat_csv": _csv(rows), "config": config, "detect_on": use})
    duration = x.shape[1] / fs
    comparison = None
    if other is not None:
        comparison = {use: _version_payload(chosen, fs, feat, events),
                      other[0]: _version_payload(pre[other[0]], fs, other[1]["feat"], other[1]["events"]),
                      "note": "Detection was run on both versions with identical settings. A difference in events does not show that "
                              "preprocessing improved or harmed detection in general; that needs labelled recordings."}
    return {"job_id": job, "engine": "python-numpy/scipy", "processing_s": time.perf_counter() - t_start,
            "detect_on": use, "detect_on_note": f"Results were produced from the {use} audio ({'filtered/noise-reduced' if use == 'processed' else 'channel mix + DC removal only'}).",
            "preprocessing": {"active": active, "steps": pre["steps"], "processing_steps": pre["processing_steps"]},
            "summary": {"duration_s": duration, "sample_rate_hz": fs, "channels": int(x.shape[0]), "n_events": len(events),
                        "total_event_s": total, "event_fraction": total / duration if duration else 0.0},
            "events": events, "config": {"detector": main["detector"], "features": feat["meta"]},
            "tracks": rsvc.tracks_payload(feat), "spectrum": spec, "spectrogram": sgram, "spectrogram_original": sgram_orig,
            "comparison": comparison, "waveform": _wave_payload(x, fs),
            "waveform_processed": _wave_payload(pre["processed"][None, :], fs) if active else None,
            "disclaimer": "Academic prototype: candidate events are heuristic and NOT a safety-critical warning."}


def _wav_response(y, fs, name, headers=None):
    body, _ = audio_io.encode_wav(y, fs, "float32")
    return Response(body, media_type="audio/wav", headers={"Content-Disposition": f'attachment; filename="{name}"', **(headers or {})})


@router.get("/roadsonic/{job_id}/audio")
def rs_audio(job_id: str, version: str = "original"):
    j = _rs_job(job_id)
    if version == "original":
        return _wav_response(j["x"], j["fs"], "roadsonic_original.wav")
    if version == "processed":
        if j["mono_processed"] is None:
            raise HTTPException(404, "no processed version exists for this analysis (no filter or noise reduction configured)")
        y, g = enh.peak_guard(j["mono_processed"][None, :], -0.5)
        return _wav_response(y, j["fs"], "roadsonic_processed.wav", {"X-Peak-Guard-Gain-Db": f"{g:.3f}"})
    raise HTTPException(422, "version must be original or processed")


@router.get("/roadsonic/{job_id}/event/{index}/audio")
def rs_event_audio(job_id: str, index: int, pre: float = 2.0, post: float = 2.0, version: str = "original"):
    j = _rs_job(job_id)
    if not 0 <= index < len(j["events"]):
        raise HTTPException(404, "event index out of range")
    if not (0 <= pre <= 30 and 0 <= post <= 30):
        raise HTTPException(422, "pre and post context must be within 0-30 s")
    if version == "processed" and j["mono_processed"] is None:
        raise HTTPException(404, "no processed version exists for this analysis")
    if version not in ("original", "processed"):
        raise HTTPException(422, "version must be original or processed")
    e, fs = j["events"][index], j["fs"]
    src = j["x"] if version == "original" else j["mono_processed"][None, :]
    clip, i0, i1 = rsvc.event_clip(src, fs, e, pre, post)
    return _wav_response(clip, fs, f"roadsonic_event_{index + 1}.wav",
                         {"X-Clip-Start-S": f"{i0 / fs:.4f}", "X-Clip-End-S": f"{i1 / fs:.4f}", "X-Event-Start-S": f"{e['start_s']:.4f}", "X-Event-End-S": f"{e['end_s']:.4f}"})


@router.post("/roadsonic/{job_id}/evaluate")
def rs_evaluate(job_id: str, req: EvaluateReq):
    """Event-level evaluation against intervals YOU label. Meaningful only with genuine ground truth."""
    j = _rs_job(job_id)
    duration = j["x"].shape[1] / j["fs"]
    truth = [(t.start_s, t.end_s) for t in req.truth]
    if any(b > duration + 1e-6 for _, b in truth):
        raise HTTPException(422, f"a labelled interval ends after the recording ({duration:.2f} s)")
    try:
        r = evaluate_events(j["events"], truth, duration, req.min_iou)
    except ValueError as e:
        raise HTTPException(422, str(e))
    r["note"] = "Computed from your labels and this run's settings; it does not generalise to other recordings. Settings tuned on the same recording inflate these numbers."
    return r


@router.get("/roadsonic/{job_id}/export")
def rs_export(job_id: str, kind: str = "events_csv"):
    j = _rs_job(job_id)
    summary = {"n_events": len(j["events"]), "total_event_s": float(sum(e["duration_s"] for e in j["events"]))}
    m = {"events_csv": (j["ev_csv"], "text/csv", "events.csv"), "features_csv": (j["feat_csv"], "text/csv", "features.csv"),
         "events_json": (json.dumps(j["events"], indent=2), "application/json", "events.json"),
         "config_json": (json.dumps(j["config"], indent=2), "application/json", "detection_config.json"),
         "results_json": (json.dumps({"disclaimer": "Academic prototype; candidate events only", "summary": summary, "config": j["config"],
                                      "events": j["events"], "source_label": j.get("name")}, indent=2), "application/json", "roadsonic_results.json")}
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
    return _report_response(rb.roadsonic_report, _rs_job(job_id), format, "roadsonic_report")


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
