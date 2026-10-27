"""Original-vs-processed metrics through the configured engine, in the existing response shape."""
from __future__ import annotations
import numpy as np
from app.matlab import engine_adapter as ea
from app.processing import comparison as cmp_py


def compare_with_engine(x: np.ndarray, y: np.ndarray, runner=None) -> tuple[dict, dict]:
    """Returns (metrics, engine_info). `metrics` keeps the shape of comparison.compare_signals; rms_before, rms_after and
    mse come from the engine that actually ran (see engine_info), the derived dB fields are recomputed from them."""
    base = cmp_py.compare_signals(x, y)                       # also validates alignment (ValueError)
    vals, info = ea.compare_info(x, y, runner)
    per = []
    for i, ch in enumerate(base["per_channel"]):
        rb, ra, mse = vals["rms_before"][i], vals["rms_after"][i], vals["mse"][i]
        per.append({"rms_before": rb, "rms_after": ra,
                    "rms_change_db": float(20 * np.log10(ra / rb)) if rb > 0 and ra > 0 else None, "mse": mse,
                    "relative_change_db": float(10 * np.log10(mse / rb ** 2)) if mse > 0 and rb > 0 else None})
    out = {"per_channel": per, "note": base["note"], "engine": ea.engine_label(info)}
    return out, info
