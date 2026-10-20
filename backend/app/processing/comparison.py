"""Signal-change metrics for aligned signals.

MSE = (1/N) sum (x[n]-y[n])^2   -- a measure of how much the signal CHANGED.
It is not a quality score and not a denoising score: without a clean reference
there is no defensible SNR. Alignment is explicit: lengths must match (the
filters in this project preserve length); otherwise an error is raised.
"""
from __future__ import annotations

import numpy as np


def compare_signals(x: np.ndarray, y: np.ndarray) -> dict:
    x = np.atleast_2d(np.asarray(x, dtype=np.float64))
    y = np.atleast_2d(np.asarray(y, dtype=np.float64))
    if x.shape != y.shape:
        raise ValueError(f"signals are not aligned: shapes {x.shape} vs {y.shape}")
    out = []
    for xc, yc in zip(x, y):
        rms_x = float(np.sqrt(np.mean(xc ** 2)))
        rms_y = float(np.sqrt(np.mean(yc ** 2)))
        mse = float(np.mean((xc - yc) ** 2))
        out.append({"rms_before": rms_x, "rms_after": rms_y,
                    "rms_change_db": float(20 * np.log10(rms_y / rms_x)) if rms_x > 0 and rms_y > 0 else None,
                    "mse": mse,
                    "relative_change_db": float(10 * np.log10(mse / np.mean(xc ** 2))) if mse > 0 and rms_x > 0 else None})
    return {"per_channel": out,
            "note": "MSE measures signal change between aligned signals; it is not a denoising score "
                    "because no clean reference is available."}
