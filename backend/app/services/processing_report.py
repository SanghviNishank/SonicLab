"""Automatic processing report for one ClearVoice job. Everything is taken from the stored job (real settings and measurements);
the explanation text is generated from those settings, never from a template that assumes an outcome."""
from __future__ import annotations
import platform
import numpy as np, scipy
from app.processing import statistics as st
from app.services import reports, studio, report_plots

LIMITATIONS = [
    "Filtering cannot recover information that was never recorded.",
    "Some background sounds overlap with speech frequencies, so a filter cannot remove them without also affecting the voice.",
    "Aggressive filtering (a high order or a cutoff inside the speech band) can distort the sound or create ringing.",
    "A lower RMS does not automatically mean better audio; it may only mean energy was removed, wanted or not.",
    "SNR improvement is not claimed: it needs a clean reference or a valid noise estimate, and neither is available here.",
]
_FT = {"lowpass": ("low-pass", "reduce frequency components above the selected cutoff", "This can reduce hiss and high-frequency noise, but it also removes high-frequency detail such as consonant sharpness."),
       "highpass": ("high-pass", "reduce frequency components below the selected cutoff", "This may reduce low-frequency rumble, but it can also affect low-frequency voice components if the cutoff is high."),
       "bandpass": ("band-pass", "keep the band between the lower and upper cutoffs and reduce frequencies outside it", "This isolates a band, but speech energy outside the band is lost."),
       "bandstop": ("band-stop", "reduce frequency components between the lower and upper cutoffs", "This can suppress a narrow interference tone, but anything wanted inside that band is reduced too.")}


def explain(config: dict) -> str:
    if config.get("pipeline") == "voice":
        st_ = config.get("stages", {})
        on = [k.replace("_", " ") for k, v in st_.items() if isinstance(v, dict) and v.get("enabled")]
        return (f"The voice-enhancement pipeline (preset '{config.get('preset')}') was applied with these enabled stages: {', '.join(on) or 'none'}. "
                "These stages reduce slowly varying noise and low-frequency rumble using the settings listed above. They cannot remove music or other talkers, "
                "and they can change the character of the voice. The processed waveform and spectrum are displayed for comparison.")
    t = config.get("filter_type"); name, what, caveat = _FT.get(t, (str(t), "modify the signal", ""))
    cut = " and ".join(f"{c:g} Hz" for c in config.get("cutoff_hz", []))
    meth = ("Zero-phase (forward-backward) filtering was used, so no phase delay was introduced; the effective magnitude response is squared (about -6 dB at the cutoff)."
            if config.get("method") == "zero_phase" else "Causal (single-pass) filtering was used; it delays the signal slightly (non-zero phase), and the magnitude is about -3 dB at the cutoff.")
    return (f"A {name} Butterworth filter of order {config.get('order')} (cutoff {cut}) was applied to {what}. {meth} {caveat} "
            "The processed waveform and frequency spectrum are shown next to the original for comparison; whether the result sounds better has to be judged by listening.")


def noise_reduction(config: dict) -> dict:
    nr = (config.get("stages") or {}).get("noise_reduction") if config.get("pipeline") == "voice" else None
    if isinstance(nr, dict) and nr.get("enabled"):
        return {"applied": True, "settings": nr}
    return {"applied": False, "note": "No noise-reduction stage was applied in this session." if config.get("pipeline") != "voice" else "The selected preset did not enable noise reduction."}


def build(job: dict) -> dict:
    x, y, fs = np.atleast_2d(job["x"]), np.atleast_2d(job["y"]).astype(np.float64), job["fs"]
    meta, cfg = job["meta"], job["config"]
    lv = studio.levels(x, y, fs)
    cmpn = [{"channel": i, "rms_before": a["rms"], "rms_after": b["rms"], "peak_before": a["peak"], "peak_after": b["peak"],
             "mean_before": a["mean"], "mean_after": b["mean"], "clipped_before": a["clipped_samples"], "clipped_after": b["clipped_samples"]}
            for i, (a, b) in enumerate(zip(lv["original"]["channels"], lv["processed"]["channels"]))]
    return {
        "title": "ClearVoice processing report", "generated": reports.now_iso(),
        "software": {"app": "SignalSystem", "app_version": reports.APP_VERSION, "engine": cfg.get("engine", "python-scipy"), "python": platform.python_version(),
                     "numpy": np.__version__, "scipy": scipy.__version__},
        "recording": {"filename": job.get("name", "unknown"), "sample_rate_hz": meta["sample_rate_hz"], "channels": meta["channels"], "duration_s": meta["duration_s"],
                      "samples_per_channel": meta["samples_per_channel"], "file_size_bytes": meta.get("file_size_bytes"), "source_format": meta.get("source_format"), "sample_format": meta.get("sample_format")},
        "analysis": {"channels": [{"channel": i, "rms": c["rms"], "peak": c["peak"], "mean": c["mean"]} for i, c in enumerate(lv["original"]["channels"])],
                     "dominant_peaks_original": job["before"].get("peaks", []), "dominant_peaks_processed": job["after"].get("peaks", []),
                     "spectrum_window": job["before"].get("window"), "frequency_note": "Spectral peaks are estimates of strong frequency components in channel 0; they do not by themselves identify noise or a sound source."},
        "processing": {"kind": cfg.get("pipeline", "digital_filter"), "config": cfg, "noise_reduction": noise_reduction(cfg), "processing_s": job.get("processing_s"),
                       "warnings": job.get("warnings", [])},
        "comparison": {"per_channel": cmpn, "same_length": lv["same_length"], "duration_difference_s": lv["duration_difference_s"], "metrics": job.get("metrics"), "notes": lv["notes"]},
        "explanation": explain(cfg), "limitations": LIMITATIONS,
        "reproducibility": {"note": "Re-running the same settings on the same file with the same software versions reproduces this result.", "parameters": cfg},
    }


def _f(v, nd=5):
    return "-" if v is None else (f"{v:.{nd}g}" if isinstance(v, float) else str(v))


def to_model(r: dict, job: dict, with_plots: bool = True) -> dict:
    rec, an, pr, cm = r["recording"], r["analysis"], r["processing"], r["comparison"]
    s = [{"heading": "1. Recording information", "paragraphs": [], "table": {"columns": ["Property", "Value"], "rows": [
            ["Original filename (as supplied by the browser)", rec["filename"]], ["Sample rate (Hz)", _f(rec["sample_rate_hz"])], ["Channels", str(rec["channels"])],
            ["Duration (s)", _f(rec["duration_s"], 6)], ["File size (bytes)", _f(rec["file_size_bytes"])], ["Format", _f(rec["source_format"])]]}},
         {"heading": "2. Audio analysis (original)", "paragraphs": [an["frequency_note"]], "table": {"columns": ["Channel", "RMS", "Peak", "Mean"], "rows": [
            [str(c["channel"]), _f(c["rms"]), _f(c["peak"]), _f(c["mean"])] for c in an["channels"]]}},
         {"heading": "Dominant frequency components (original, channel 0)", "paragraphs": [] if an["dominant_peaks_original"] else ["No clear spectral peak was found."],
          "table": {"columns": ["Frequency (Hz)", "Amplitude"], "rows": [[_f(p["frequency_hz"]), _f(p["amplitude"])] for p in an["dominant_peaks_original"]]} if an["dominant_peaks_original"] else None},
         {"heading": "3. Processing information", "paragraphs": [f"Processing duration: {_f(pr['processing_s'], 3)} s.  Engine: {r['software']['engine']}."] + list(pr["warnings"]),
          "table": {"columns": ["Setting", "Value"], "rows": [[k, _f(v if not isinstance(v, (dict, list)) else str(v))] for k, v in pr["config"].items()]}},
         {"heading": "Noise reduction", "paragraphs": [str(pr["noise_reduction"].get("note") or pr["noise_reduction"].get("settings"))]},
         {"heading": "4. Before and after comparison", "paragraphs": cm["notes"], "table": {"columns": ["Channel", "RMS before", "RMS after", "Peak before", "Peak after", "Clipped before", "Clipped after"], "rows": [
            [str(c["channel"]), _f(c["rms_before"]), _f(c["rms_after"]), _f(c["peak_before"]), _f(c["peak_after"]), str(c["clipped_before"]), str(c["clipped_after"])] for c in cm["per_channel"]]}}]
    if with_plots and report_plots.available():
        s.append({"heading": "Waveform and spectrum comparison", "paragraphs": [], "images": [
            ("Waveform, channel 0 (display-decimated, extrema preserved)", report_plots.waveform_compare(job["x"], job["y"], job["fs"])),
            ("Amplitude spectrum, channel 0", report_plots.spectrum_compare(job["before"], job["after"]))]})
    s += [{"heading": "5. Processing explanation", "paragraphs": [r["explanation"]]},
          {"heading": "6. Limitations", "paragraphs": r["limitations"]},
          {"heading": "Reproducibility", "paragraphs": [r["reproducibility"]["note"], "Software: " + ", ".join(f"{k} {v}" for k, v in r["software"].items())]}]
    return {"title": r["title"], "subtitle": f"SignalSystem {r['software']['app_version']}", "generated": r["generated"], "sections": s}


def to_markdown(r: dict) -> str:
    rec, pr, cm = r["recording"], r["processing"], r["comparison"]
    L = [f"# {r['title']}", f"Generated {r['generated']} by {r['software']['app']} {r['software']['app_version']}", "", "## Recording",
         *(f"- {k}: {_f(v)}" for k, v in rec.items()), "", "## Processing", f"- Duration: {_f(pr['processing_s'], 3)} s", "- Parameters:",
         *(f"  - {k}: {_f(v if not isinstance(v, (dict, list)) else str(v))}" for k, v in pr["config"].items()), "", "## Before / after (per channel)"]
    for c in cm["per_channel"]:
        L.append(f"- ch{c['channel']}: RMS {_f(c['rms_before'])} -> {_f(c['rms_after'])}; peak {_f(c['peak_before'])} -> {_f(c['peak_after'])}; clipped {c['clipped_before']} -> {c['clipped_after']}")
    L += ["", "## Explanation", r["explanation"], "", "## Limitations", *(f"- {x}" for x in r["limitations"]), "", "## Software", ", ".join(f"{k} {v}" for k, v in r["software"].items())]
    return "\n".join(L) + "\n"
