"""Builds report models from stored job data (real arrays and results only)."""
from __future__ import annotations
import numpy as np
from app.processing import statistics as st, fft_analysis as fa
from . import reports, report_plots


def clearvoice_report(job: dict, with_plots: bool = True) -> dict:
    x, y, fs = job["x"], job["y"], job["fs"]
    imgs = []
    if with_plots and report_plots.available():
        imgs = [("Waveform, channel 0 (display-decimated, extrema preserved)", report_plots.waveform_compare(x, y, fs)),
                ("Amplitude spectrum, channel 0", report_plots.spectrum_compare(job["before"], job["after"]))]
    return reports.clearvoice_model(
        source_name=job.get("name", "unknown"), meta=job["meta"], stats_before=st.audio_statistics(x, fs),
        stats_after=st.audio_statistics(y, fs), config=job["config"], history=job.get("history", []), metrics=job["metrics"],
        quality=job.get("quality"), warnings=job["warnings"], peaks=job["before"].get("peaks", []),
        engine=job["config"].get("engine", "python-scipy"), images=imgs)


def feature_summary(feat: dict) -> dict:
    keys = ["rms_db", "centroid_hz", "bandwidth_hz", "flatness", "dom_freq_hz", "peak_prominence_db", "tonal_ratio", "zcr"]
    return {"n_frames": int(feat["time_s"].size),
            "features": {k: {"mean": float(np.mean(feat[k])), "min": float(np.min(feat[k])), "max": float(np.max(feat[k]))} for k in keys}}


def roadsonic_report(job: dict, with_plots: bool = True) -> dict:
    imgs = []
    if with_plots and report_plots.available():
        imgs = [("Waveform and dominant-frequency track with candidate events", report_plots.siren_overview(job["mono"], job["fs"], job["feat"], job["events"]))]
    return reports.roadsonic_model(
        source_name=job.get("name", "unknown"), meta=job["meta"], config=job["config"], preprocessing=job["config"]["preprocessing"],
        events=job["events"], feat_summary=feature_summary(job["feat"]), engine="python-numpy/scipy", images=imgs,
        detect_on=job.get("detect_on", "original"))
