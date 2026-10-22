"""HTML and PDF report generation from a neutral report model (real session data only).

model = {"title", "subtitle", "generated", "sections": [{"heading", "paragraphs": [str], "table": {"columns", "rows"} | None,
          "images": [(caption, png_bytes)]}]}
"""
from __future__ import annotations
import base64, datetime as dt, html, io
from xml.sax.saxutils import escape as xesc

APP_VERSION = "0.3.0"


def _fmt(v, nd=4):
    if v is None: return "-"
    if isinstance(v, float): return f"{v:.{nd}g}"
    return str(v)


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def stats_table(stats: dict) -> dict:
    cols = ["Channel", "min", "max", "mean", "RMS", "variance (population)", "peak", "clipped samples"]
    rows = [[str(i), _fmt(c["min"]), _fmt(c["max"]), _fmt(c["mean"]), _fmt(c["rms"]), _fmt(c["variance"]), _fmt(c["peak_abs"]),
             str(c["clipped_samples"])] for i, c in enumerate(stats["per_channel"])]
    return {"columns": cols, "rows": rows}


def clearvoice_model(*, source_name: str, meta: dict, stats_before: dict, stats_after: dict | None, config: dict,
                     history: list, metrics: dict | None, quality: dict | None, warnings: list, peaks: list,
                     engine: str, images: list) -> dict:
    s = []
    s.append({"heading": "Audio", "paragraphs": [f"Source file label (as supplied by the browser, not trusted): {source_name}"],
              "table": {"columns": ["Property", "Value"], "rows": [["Sample rate (Hz)", _fmt(meta["sample_rate_hz"])],
                        ["Channels", str(meta["channels"])], ["Duration (s)", _fmt(meta["duration_s"], 6)],
                        ["Samples per channel", str(meta["samples_per_channel"])], ["Source format", _fmt(meta.get("source_format"))],
                        ["Decoded as", _fmt(meta.get("sample_format"))]]}})
    s.append({"heading": "Statistics - original", "paragraphs": ["Amplitudes relative to full scale = 1.0. Variance is the population variance (ddof = 0)."],
              "table": stats_table(stats_before)})
    if stats_after:
        s.append({"heading": "Statistics - processed", "paragraphs": [], "table": stats_table(stats_after)})
    s.append({"heading": "Processing configuration", "paragraphs": [f"Engine: {engine}. Original audio is never modified."],
              "table": {"columns": ["Key", "Value"], "rows": [[k, _fmt(v if not isinstance(v, (dict, list)) else str(v))] for k, v in config.items()]}})
    if history:
        s.append({"heading": "Processing history", "paragraphs": [],
                  "table": {"columns": ["#", "Stage", "Peak after", "RMS after", "Settings"],
                            "rows": [[str(i + 1), h["stage"], _fmt(h.get("peak")), _fmt(h.get("rms")), str(h.get("params"))[:300]] for i, h in enumerate(history)]}})
    if metrics:
        s.append({"heading": "Comparison metrics",
                  "paragraphs": [metrics["note"], "MSE is a measure of signal change; it is not a quality or denoising score. SNR is not reported because no clean reference exists for a real recording."],
                  "table": {"columns": ["Channel", "RMS before", "RMS after", "RMS change (dB)", "MSE"],
                            "rows": [[str(i), _fmt(m["rms_before"]), _fmt(m["rms_after"]), _fmt(m["rms_change_db"]), _fmt(m["mse"])] for i, m in enumerate(metrics["per_channel"])]}})
    if quality:
        s.append({"heading": "Output quality checks", "paragraphs": ["Result: " + ("passed" if quality["ok"] else "FAILED - do not treat as successful enhancement")] + quality["issues"],
                  "table": {"columns": ["Peak", "RMS", "Clipped samples", "Duration (s)", "Sample rate"],
                            "rows": [[_fmt(quality["peak"]), _fmt(quality["rms"]), str(quality["clipped_samples"]), _fmt(quality["duration_s"], 6), _fmt(quality["sample_rate"])]]}})
    if peaks:
        s.append({"heading": "Dominant spectral peaks (original, channel 0)", "paragraphs": ["Peak estimates, not proof of true source frequencies."],
                  "table": {"columns": ["Frequency (Hz)", "Amplitude"], "rows": [[_fmt(p["frequency_hz"]), _fmt(p["amplitude"])] for p in peaks]}})
    if images:
        s.append({"heading": "Plots", "paragraphs": [], "images": images})
    s.append({"heading": "Warnings and limitations",
              "paragraphs": list(warnings) + ["Subjective speech quality and intelligibility are not measured by this report.",
                                              "A filter removes frequency ranges; it is not a general denoiser."]})
    return {"title": "ClearVoice analysis report", "subtitle": f"SignalSystem {APP_VERSION}", "generated": now_iso(), "sections": s}


def roadsonic_model(*, source_name: str, meta: dict, config: dict, preprocessing: list, events: list, feat_summary: dict,
                    engine: str, images: list, detect_on: str = "original") -> dict:
    s = [{"heading": "Disclaimer", "paragraphs": ["Academic prototype. Events below are CANDIDATE siren events produced by interpretable heuristic rules. "
                                                   "They are not confirmed sirens, the score is not a probability, and this is not a safety-critical warning system. "
                                                   "The detector has not been evaluated on labelled real recordings."]},
         {"heading": "Audio", "paragraphs": [f"Source file label (not trusted): {source_name}"],
          "table": {"columns": ["Property", "Value"], "rows": [["Sample rate (Hz)", _fmt(meta["sample_rate_hz"])], ["Channels", str(meta["channels"])],
                    ["Duration (s)", _fmt(meta["duration_s"], 6)], ["Source format", _fmt(meta.get("source_format"))]]}},
         {"heading": "Preprocessing and audio version analysed", "paragraphs": ["Engine: " + engine, f"Detection results below were produced from the {detect_on} audio."] + [f"{p['step']}: {p['detail']}" for p in preprocessing]},
         {"heading": "Detector and feature configuration", "paragraphs": [],
          "table": {"columns": ["Key", "Value"], "rows": [[k, _fmt(v)] for k, v in {**config["detector"], **{"feature_" + k: v for k, v in config["features"].items()}}.items()]}},
         {"heading": f"Feature summary ({feat_summary['n_frames']} frames)", "paragraphs": [],
          "table": {"columns": ["Feature", "mean", "min", "max"], "rows": [[k, _fmt(v["mean"]), _fmt(v["min"]), _fmt(v["max"])] for k, v in feat_summary["features"].items()]}}]
    if events:
        s.append({"heading": f"Candidate siren events ({len(events)})", "paragraphs": ["Heuristic score = mean of three normalised evidence terms; it is not a calibrated probability."],
                  "table": {"columns": ["#", "Start (s)", "End (s)", "Duration (s)", "Score*", "Pattern", "Tonal fraction", "f0 range (Hz)", "f0 std (Hz)", "Rules"],
                            "rows": [[str(i + 1), _fmt(e["start_s"], 5), _fmt(e["end_s"], 5), _fmt(e["duration_s"], 4), _fmt(e["heuristic_score"], 3), e.get("trajectory", {}).get("pattern", "-"),
                                      _fmt(e["features"]["tonal_fraction"], 3), _fmt(e["features"]["f0_range_hz"], 4), _fmt(e["features"]["f0_std_hz"], 4),
                                      ", ".join(f"{k}={v}" for k, v in e["rules"].items())] for i, e in enumerate(events)]}})
        s.append({"heading": "Why each interval was flagged", "paragraphs": [f"Event {i + 1}: {e.get('explanation', '')}" for i, e in enumerate(events)]})
    else:
        s.append({"heading": "Candidate siren events (0)", "paragraphs": ["No candidate events under these rules. This does not prove that no siren is present."]})
    if images: s.append({"heading": "Plots", "paragraphs": [], "images": images})
    s.append({"heading": "Known limitations", "paragraphs": [
        "Possible false positives: horns, alarms, musical tones, squealing brakes, some speech.",
        "Possible missed detections: distant or weak sirens, heavy traffic noise (a very weak synthetic siren is missed in the project tests).",
        "Timestamps are frame-based (frame centre +/- half a frame); tolerance used in tests: 0.6-0.8 s."]})
    return {"title": "RoadSonic candidate-event report", "subtitle": f"SignalSystem {APP_VERSION}", "generated": now_iso(), "sections": s}


# ------------------------------------------------------------------ renderers
def to_html(m: dict) -> str:
    e = html.escape
    out = ["<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
           f"<title>{e(m['title'])}</title><style>body{{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem;color:#1b1e27}}"
           "table{border-collapse:collapse;width:100%;margin:.5rem 0;font-size:.85rem}th,td{border:1px solid #ccd;padding:.25rem .5rem;text-align:left;vertical-align:top}"
           "th{background:#eef}.wrap{overflow-x:auto}img{max-width:100%}h2{border-bottom:1px solid #ccd;padding-bottom:.2rem}</style></head><body>",
           f"<h1>{e(m['title'])}</h1><p>{e(m['subtitle'])} &middot; generated {e(m['generated'])}</p>"]
    for s in m["sections"]:
        out.append(f"<h2>{e(s['heading'])}</h2>")
        for p in s.get("paragraphs", []): out.append(f"<p>{e(str(p))}</p>")
        t = s.get("table")
        if t:
            out.append("<div class='wrap'><table><thead><tr>" + "".join(f"<th>{e(c)}</th>" for c in t["columns"]) + "</tr></thead><tbody>")
            for r in t["rows"]: out.append("<tr>" + "".join(f"<td>{e(str(c))}</td>" for c in r) + "</tr>")
            out.append("</tbody></table></div>")
        for cap, png in s.get("images", []):
            out.append(f"<figure><img alt='{e(cap)}' src='data:image/png;base64,{base64.b64encode(png).decode()}'><figcaption>{e(cap)}</figcaption></figure>")
    out.append("</body></html>")
    return "".join(out)


def to_pdf(m: dict) -> bytes:
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib.units import mm
        from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
    except Exception:
        raise RuntimeError("PDF reports need the 'reportlab' package (pip install reportlab); the HTML report is still available")
    st = getSampleStyleSheet(); small = st["BodyText"].clone("small"); small.fontSize = 7.5; small.leading = 9
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=15 * mm, rightMargin=15 * mm, topMargin=15 * mm, bottomMargin=15 * mm, title=m["title"])
    W = A4[0] - 30 * mm
    el = [Paragraph(xesc(m["title"]), st["Title"]), Paragraph(xesc(f"{m['subtitle']} - generated {m['generated']}"), st["BodyText"]), Spacer(1, 6)]
    for s in m["sections"]:
        el.append(Paragraph(xesc(s["heading"]), st["Heading2"]))
        for p in s.get("paragraphs", []): el.append(Paragraph(xesc(str(p)), st["BodyText"]))
        t = s.get("table")
        if t:
            data = [[Paragraph(f"<b>{xesc(c)}</b>", small) for c in t["columns"]]] + [[Paragraph(xesc(str(c)), small) for c in r] for r in t["rows"]]
            tb = Table(data, colWidths=[W / len(t["columns"])] * len(t["columns"]), repeatRows=1)
            tb.setStyle(TableStyle([("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8ecf7")), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
            el += [Spacer(1, 3), tb, Spacer(1, 6)]
        for cap, png in s.get("images", []):
            img = Image(io.BytesIO(png)); r = W / img.imageWidth; img.drawWidth, img.drawHeight = W, img.imageHeight * r
            el += [img, Paragraph(xesc(cap), small), Spacer(1, 6)]
    doc.build(el)
    return buf.getvalue()
