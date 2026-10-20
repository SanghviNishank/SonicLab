"""Engine selection: Python/SciPy (default) or MATLAB Engine for Python.

Policy (explicit, never silent):
  CS_ENGINE=python  (default) -> always Python; results are labelled 'python-numpy-fft'.
  CS_ENGINE=matlab            -> MATLAB must be used. If it is unavailable or errors, raise EngineError (HTTP 503)
                                 UNLESS CS_ENGINE_FALLBACK=python, in which case Python is used and the result is
                                 labelled 'python-numpy-fft (fallback: <reason>)' - never as MATLAB.
MATLAB is started once per process and reused (one lock; MATLAB Engine is not thread-safe).
Only operations with a tested MATLAB counterpart (calculate_single_sided_spectrum.m) are routed here.
"""
from __future__ import annotations
import os, threading
from pathlib import Path
import numpy as np
from app.processing import fft_analysis as fa

MATLAB_DIR = str(Path(__file__).resolve().parents[3] / "matlab" / "functions")


class EngineError(RuntimeError):
    pass


class MatlabRunner:
    def __init__(self, module_factory=None, functions_dir: str = MATLAB_DIR):
        self._factory = module_factory or self._import_real
        self._lock = threading.Lock()
        self._eng = None; self._mod = None; self._dir = functions_dir; self.release = None

    @staticmethod
    def _import_real():
        import matlab.engine as me, matlab as m  # noqa
        return m, me

    def _start(self):
        if self._eng is None:
            try:
                self._mod, me = self._factory()
                self._eng = me.start_matlab()
                self._eng.addpath(self._dir, nargout=0)
                self.release = str(self._eng.version())
            except Exception as e:
                self._eng = None
                raise EngineError(f"MATLAB Engine unavailable: {type(e).__name__}: {e}") from None

    def available(self) -> tuple[bool, str]:
        try:
            self._start(); return True, f"MATLAB {self.release}"
        except EngineError as e:
            return False, str(e)

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


_runner = MatlabRunner()


def configured() -> tuple[str, str]:
    return os.getenv("CS_ENGINE", "python").lower(), os.getenv("CS_ENGINE_FALLBACK", "none").lower()


def status() -> dict:
    mode, fb = configured()
    ok, msg = _runner.available() if mode == "matlab" else (None, "not probed (CS_ENGINE != matlab)")
    return {"configured_engine": mode, "fallback": fb, "matlab_available": ok, "detail": msg}


def single_sided_spectrum(x, fs, window="hann", n_fft=None, runner: MatlabRunner | None = None) -> tuple[dict, str]:
    """Returns (spectrum, engine_label). The label names the engine that ACTUALLY computed the result."""
    mode, fb = configured()
    if mode not in ("python", "matlab"):
        raise EngineError("CS_ENGINE must be 'python' or 'matlab'")
    if mode == "python":
        return fa.single_sided_spectrum(x, fs, window, n_fft), "python-numpy-fft"
    try:
        return (runner or _runner).spectrum(np.asarray(x, dtype=float), fs, window, n_fft), "matlab"
    except EngineError as e:
        if fb == "python":
            return fa.single_sided_spectrum(x, fs, window, n_fft), f"python-numpy-fft (fallback: {e})"
        raise
