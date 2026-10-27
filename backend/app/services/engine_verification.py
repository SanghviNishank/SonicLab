"""Cross-engine numerical verification (MATLAB vs Python) on a real recording.

Runs each operation through the configured engine and through pure Python and reports the maximum absolute
difference against a documented tolerance. If the configured engine did not actually run MATLAB (python mode, or a
fallback), the comparison is reported as NOT PERFORMED instead of passing trivially.
"""
from __future__ import annotations
import numpy as np
from app.matlab import engine_adapter as ea
from app.processing import fft_analysis as fa, filters as flt

TOLERANCES = {"spectrum": 1e-9, "statistics": 1e-9, "filter_design": 1e-9, "compare": 1e-9}
EXPLANATION = ("Tolerance is an absolute difference. FFT, statistics and comparison use IEEE double precision in both "
               "languages, so differences are rounding-level (~1e-12); filter responses are compared on |H| (linear) "
               "because MATLAB and SciPy may order second-order sections differently.")


def _entry(op: str, info: dict, diff: float | None) -> dict:
    performed = info["engine_used"] == "matlab" and diff is not None
    return {"operation": op, "engine_info": info, "tolerance": TOLERANCES[op], "max_abs_diff": diff if performed else None,
            "comparison_performed": performed, "passed": (bool(diff <= TOLERANCES[op]) if performed else None),
            "reason_not_performed": None if performed else
            ("configured engine did not run MATLAB (" + (info["fallback_reason"] or "CS_ENGINE=python") + ")")}


def verify_engines(x2: np.ndarray, fs: float, runner=None, filter_type: str = "lowpass", order: int = 4,
                   cutoff: list[float] | None = None, window: str = "hann") -> dict:
    x2 = np.atleast_2d(np.asarray(x2, dtype=float))
    cutoff = cutoff or [min(1000.0, fs / 4)]
    out = []
    ch = x2[0]
    s, info = ea.spectrum_info(ch, fs, window, None, runner)
    ref = fa.single_sided_spectrum(ch, fs, window, None)
    d = max(float(np.max(np.abs(s["amplitude"] - ref["amplitude"]))), float(np.max(np.abs(s["freqs_hz"] - ref["freqs_hz"])))) \
        if s["amplitude"].shape == ref["amplitude"].shape else float("inf")
    out.append(_entry("spectrum", info, d))
    st, info = ea.statistics_info(x2, runner); ref_st = ea._py_statistics(x2)
    out.append(_entry("statistics", info, max(float(np.max(np.abs(np.array(st[k]) - np.array(ref_st[k])))) for k in ea._STAT_KEYS)))
    fd, info = ea.filter_design_info(filter_type, order, cutoff, fs, "causal", 512, runner)
    ref_resp = flt.frequency_response(flt.design_filter(filter_type, order, cutoff, fs), fs, "causal", 512)
    out.append(_entry("filter_design", info, float(np.max(np.abs(fd["response"]["magnitude"] - ref_resp["magnitude"])))))
    y2 = 0.5 * x2
    cm, info = ea.compare_info(x2, y2, runner)
    from app.processing import comparison as cp
    rp = cp.compare_signals(x2, y2)["per_channel"]
    d = max(max(abs(a - b["rms_before"]) for a, b in zip(cm["rms_before"], rp)), max(abs(a - b["rms_after"]) for a, b in zip(cm["rms_after"], rp)),
            max(abs(a - b["mse"]) for a, b in zip(cm["mse"], rp)))
    out.append(_entry("compare", info, float(d)))
    performed = [o for o in out if o["comparison_performed"]]
    return {"configured": ea.configured()[0], "operations": out, "explanation": EXPLANATION,
            "summary": {"matlab_operations_compared": len(performed),
                        "all_passed": (all(o["passed"] for o in performed) if performed else None),
                        "note": None if performed else "No MATLAB comparison was performed; nothing here validates MATLAB."}}
