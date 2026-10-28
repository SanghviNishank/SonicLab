"""Engine selection: Python/SciPy or MATLAB Engine for Python. Never silent, never mislabelled.

CS_ENGINE (default 'python'):
  python  -> Python only.
  matlab  -> MATLAB is REQUIRED. If it is unavailable or errors, raise EngineError (HTTP 503) unless
             CS_ENGINE_FALLBACK=python is set explicitly; then Python is used and reported as a fallback.
  auto    -> try MATLAB first; if it cannot run, use Python and report fallback_used=True with the reason.
Every operation returns (result, info). `info` states which engine ACTUALLY computed the result:
  {"operation", "configured_engine", "engine_used": "matlab"|"python", "fallback_used", "fallback_reason"}
A failed MATLAB start is remembered for FAIL_COOLDOWN_S seconds so that 'auto' does not pay a long start-up
attempt on every request.

Operations with a MATLAB counterpart (all in matlab/functions/):
  spectrum      -> calculate_single_sided_spectrum.m
  statistics    -> calculate_audio_statistics.m
  filter_design -> design_digital_filter.m (MATLAB designs the SOS; the response is evaluated with SciPy sosfreqz,
                   reported in info["note"])
  compare       -> compare_signals.m
MATLAB is started once per process and reused (one lock; the Engine is not thread-safe).
"""
from __future__ import annotations
import os, threading, time
from pathlib import Path
from typing import Callable
import numpy as np
from scipy import signal
from app.processing import fft_analysis as fa, comparison as cmp_py, filters as flt

MATLAB_DIR = str(Path(__file__).resolve().parents[3] / "matlab" / "functions")
FAIL_COOLDOWN_S = 60.0
_MATLAB_TYPE = {"lowpass": "low", "highpass": "high", "bandpass": "bandpass", "bandstop": "stop"}
_STAT_KEYS = ("min", "max", "mean", "rms", "variance", "peak_abs")


class EngineError(RuntimeError):
    pass


class MatlabRunner:
    def __init__(self, module_factory=None, functions_dir: str = MATLAB_DIR, clock: Callable[[], float] = time.monotonic):
        self._factory = module_factory or self._import_real
        self._lock = threading.Lock()
        self._eng = None; self._mod = None; self._dir = functions_dir; self.release = None
        self._clock = clock; self._failed_until = 0.0; self._failure = ""

    @staticmethod
    def _import_real():
        import matlab.engine as me, matlab as m  # noqa
        return m, me

    def _start(self):
        if self._eng is not None:
            return
        if self._clock() < self._failed_until:
            raise EngineError(self._failure)
        try:
            self._mod, me = self._factory()
            self._eng = me.start_matlab()
            self._eng.addpath(self._dir, nargout=0)
            self.release = str(self._eng.version())
        except Exception as e:
            self._eng = None
            self._failure = f"MATLAB Engine unavailable: {type(e).__name__}: {e}"
            self._failed_until = self._clock() + FAIL_COOLDOWN_S
            raise EngineError(self._failure) from None

    def available(self) -> tuple[bool, str]:
        try:
            self._start(); return True, f"MATLAB {self.release}"
        except EngineError as e:
            return False, str(e)

    def _call(self, fn: str, *args, nargout: int = 1):
        with self._lock:
            self._start()
            try:
                return getattr(self._eng, fn)(*args, nargout=nargout)
            except Exception as e:
                raise EngineError(f"MATLAB call failed ({fn}): {type(e).__name__}: {e}") from None

    def _mat(self, x2: np.ndarray):
        """(channels, samples) -> MATLAB samples-by-channels double."""
        return self._mod.double(np.asarray(x2, dtype=float).T.tolist())

    # -- operations -----------------------------------------------------------------------------------------
    def spectrum(self, x: np.ndarray, fs: float, window: str, n_fft: int | None) -> dict:
        with self._lock:
            self._start()
            try:
                xs = self._mod.double(x.reshape(-1, 1).tolist())
                f, a = self._eng.calculate_single_sided_spectrum(xs, float(fs), window, float(n_fft) if n_fft else [], nargout=2)
                f, a = np.asarray(f, dtype=float).ravel(), np.asarray(a, dtype=float).ravel()
            except Exception as e:
                raise EngineError(f"MATLAB call failed: {type(e).__name__}: {e}") from None
        n = x.size; nfft = int(n_fft or n)
        w = fa.make_window(window, n)
        return {"freqs_hz": f, "amplitude": a, "power": a ** 2 / 2, "window": window, "n_fft": nfft, "n_signal": n,
                "bin_spacing_hz": fs / nfft, "nominal_resolution_hz": fs / n, "nyquist_hz": fs / 2,
                "coherent_gain": float(w.sum() / n), "amplitude_unit": "single-sided peak amplitude, full scale = 1.0",
                "power_unit": "amplitude^2/2"}

    def statistics(self, x2: np.ndarray) -> dict[str, list[float]]:
        with self._lock:
            self._start()
            try:
                s = self._eng.calculate_audio_statistics(self._mat(x2), nargout=1)
                return {k: np.atleast_1d(np.asarray(s[k], dtype=float)).ravel().tolist() for k in _STAT_KEYS}
            except Exception as e:
                raise EngineError(f"MATLAB call failed (calculate_audio_statistics): {type(e).__name__}: {e}") from None

    def design_sos(self, filter_type: str, order: int, cutoff: list[float], fs: float) -> np.ndarray:
        with self._lock:
            self._start()
            try:
                sos = self._eng.design_digital_filter(_MATLAB_TYPE[filter_type], float(order), self._mod.double([float(c) for c in cutoff]),
                                                      float(fs), nargout=1)
                return np.asarray(sos, dtype=float).reshape(-1, 6)
            except Exception as e:
                raise EngineError(f"MATLAB call failed (design_digital_filter): {type(e).__name__}: {e}") from None

    def compare(self, x2: np.ndarray, y2: np.ndarray) -> dict[str, list[float]]:
        with self._lock:
            self._start()
            try:
                r = self._eng.compare_signals(self._mat(x2), self._mat(y2), nargout=1)
                return {k: np.atleast_1d(np.asarray(r[k], dtype=float)).ravel().tolist() for k in ("rms_before", "rms_after", "mse")}
            except Exception as e:
                raise EngineError(f"MATLAB call failed (compare_signals): {type(e).__name__}: {e}") from None


_runner = MatlabRunner()


def configured() -> tuple[str, str]:
    return os.getenv("CS_ENGINE", "python").lower(), os.getenv("CS_ENGINE_FALLBACK", "none").lower()


def status() -> dict:
    mode, fb = configured()
    ok, msg = _runner.available() if mode in ("matlab", "auto") else (None, "not probed (CS_ENGINE=python)")
    return {"configured_engine": mode, "fallback": fb, "matlab_available": ok, "detail": msg}


def engine_label(info: dict) -> str:
    """Single human-readable label (kept for the existing `engine` response field)."""
    if info["engine_used"] == "matlab":
        return "matlab"
    base = "python-numpy-fft" if info["operation"] == "spectrum" else "python-scipy"
    return f"{base} (fallback: {info['fallback_reason']})" if info["fallback_used"] else base


def _dispatch(operation: str, py_fn: Callable, matlab_fn: Callable, runner: MatlabRunner | None, note: str | None = None):
    mode, fb = configured()
    if mode not in ("python", "matlab", "auto"):
        raise EngineError("CS_ENGINE must be 'python', 'matlab' or 'auto'")
    info = {"operation": operation, "configured_engine": mode, "engine_used": "python", "fallback_used": False, "fallback_reason": None}
    if note:
        info["note"] = note
    if mode == "python":
        return py_fn(), info
    try:
        result = matlab_fn(runner or _runner)
        info["engine_used"] = "matlab"
        return result, info
    except EngineError as e:
        if mode == "auto" or fb == "python":
            info.update(fallback_used=True, fallback_reason=str(e))
            return py_fn(), info
        raise


# ------------------------------------------------------------------ public operations
def spectrum_info(x, fs, window="hann", n_fft=None, runner: MatlabRunner | None = None):
    x = np.asarray(x, dtype=float)
    if x.size > fa.MAX_NFFT and configured()[0] != "python":
        # The MATLAB function computes one whole-record FFT only. Python computes the segment-averaged spectrum; say so.
        info = {"operation": "spectrum", "configured_engine": configured()[0], "engine_used": "python", "fallback_used": True,
                "fallback_reason": f"record longer than {fa.MAX_NFFT} samples: segment-averaged spectrum is computed in Python "
                                   "(MATLAB path supports whole-record FFT only)"}
        return fa.single_sided_spectrum(x, fs, window, n_fft), info
    return _dispatch("spectrum", lambda: fa.single_sided_spectrum(x, fs, window, n_fft),
                     lambda r: r.spectrum(x, fs, window, n_fft), runner)


def single_sided_spectrum(x, fs, window="hann", n_fft=None, runner: MatlabRunner | None = None) -> tuple[dict, str]:
    """Backward-compatible form: (spectrum, label)."""
    s, info = spectrum_info(x, fs, window, n_fft, runner)
    return s, engine_label(info)


def _py_statistics(x2: np.ndarray) -> dict[str, list[float]]:
    from app.processing import statistics as st
    rows = [st.channel_statistics(c, 1.0) for c in x2]
    return {k: [float(r[k]) for r in rows] for k in _STAT_KEYS}


def statistics_info(x2, runner: MatlabRunner | None = None):
    x2 = np.atleast_2d(np.asarray(x2, dtype=float))
    return _dispatch("statistics", lambda: _py_statistics(x2), lambda r: r.statistics(x2), runner)


def filter_design_info(filter_type: str, order: int, cutoff: list[float], fs: float, method: str = "zero_phase",
                       n_points: int = 1024, runner: MatlabRunner | None = None):
    """Validates exactly like the Python path, then designs the SOS in MATLAB (or SciPy) and evaluates its response."""
    flt.validate_filter(filter_type, order, cutoff, fs, method)

    def py():
        return flt.design_filter(filter_type, order, cutoff, fs)

    sos, info = _dispatch("filter_design", py, lambda r: r.design_sos(filter_type, order, cutoff, fs), runner,
                          note="design: engine_used; frequency response evaluated with SciPy sosfreqz")
    return {"sos": sos, "response": flt.frequency_response(sos, fs, method, n_points)}, info


def compare_info(x2, y2, runner: MatlabRunner | None = None):
    x2 = np.atleast_2d(np.asarray(x2, dtype=float)); y2 = np.atleast_2d(np.asarray(y2, dtype=float))
    if x2.shape != y2.shape:
        raise ValueError(f"signals are not aligned: shapes {x2.shape} vs {y2.shape}")

    def py():
        r = cmp_py.compare_signals(x2, y2)["per_channel"]
        return {"rms_before": [c["rms_before"] for c in r], "rms_after": [c["rms_after"] for c in r], "mse": [c["mse"] for c in r]}

    return _dispatch("compare", py, lambda r: r.compare(x2, y2), runner)
