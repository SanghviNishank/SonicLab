"""Adapter logic tests. A FAKE engine (pure Python, mimics the MATLAB Engine API) is injected, so these verify engine
selection, labelling, fallback policy and error handling - NOT MATLAB numerics (MATLAB is unverified; see docs)."""
import numpy as np
import pytest
from app.matlab import engine_adapter as ea
from app.processing import fft_analysis as fa
from synth import tone

FS = 16000

class FakeEng:
    def __init__(self, fail=False): self.fail = fail; self.calls = 0; self.paths = []
    def addpath(self, p, nargout=0): self.paths.append(p)
    def version(self): return "FAKE R0000x"
    def calculate_single_sided_spectrum(self, xs, fs, window, nfft, nargout=2):
        self.calls += 1
        if self.fail: raise RuntimeError("boom")
        x = np.asarray(xs, dtype=float).ravel()
        s = fa.single_sided_spectrum(x, fs, window, None if nfft == [] else int(nfft))
        return s["freqs_hz"].reshape(-1, 1), s["amplitude"].reshape(-1, 1)

def runner(eng=None, start_fails=False):
    eng = eng or FakeEng()
    class Me:
        @staticmethod
        def start_matlab():
            if start_fails: raise OSError("no matlab")
            return eng
    class M:
        double = staticmethod(lambda v: v)
    return ea.MatlabRunner(lambda: (M, Me)), eng

def set_env(mode, fb="none", monkey=None):
    import os; os.environ["CS_ENGINE"] = mode; os.environ["CS_ENGINE_FALLBACK"] = fb

def teardown_env():
    import os; os.environ.pop("CS_ENGINE", None); os.environ.pop("CS_ENGINE_FALLBACK", None)

def test_default_is_python_and_labelled_python():
    teardown_env(); s, eng = ea.single_sided_spectrum(tone(1000, FS), FS)
    assert eng == "python-numpy-fft" and s["freqs_hz"][np.argmax(s["amplitude"])] == 1000.0

def test_matlab_mode_uses_runner_once_and_labels_matlab():
    r, eng = runner(); set_env("matlab")
    try:
        for _ in range(3): s, label = ea.single_sided_spectrum(tone(1000, FS), FS, "hann", None, runner=r)
        assert label == "matlab" and eng.calls == 3 and len(eng.paths) == 1       # engine started once, reused
        assert s["freqs_hz"][np.argmax(s["amplitude"])] == 1000.0
    finally: teardown_env()

def test_matlab_unavailable_without_fallback_raises_not_silent():
    r, _ = runner(start_fails=True); set_env("matlab", "none")
    try:
        with pytest.raises(ea.EngineError): ea.single_sided_spectrum(tone(1000, FS), FS, runner=r)
    finally: teardown_env()

def test_fallback_is_explicit_and_never_labelled_matlab():
    r, _ = runner(start_fails=True); set_env("matlab", "python")
    try:
        s, label = ea.single_sided_spectrum(tone(1000, FS), FS, runner=r)
        assert label.startswith("python-numpy-fft (fallback") and "matlab" != label
        assert s["freqs_hz"][np.argmax(s["amplitude"])] == 1000.0
    finally: teardown_env()

def test_matlab_runtime_error_handled():
    r, _ = runner(FakeEng(fail=True)); set_env("matlab", "none")
    try:
        with pytest.raises(ea.EngineError) as e: ea.single_sided_spectrum(tone(1000, FS), FS, runner=r)
        assert "MATLAB call failed" in str(e.value)
    finally: teardown_env()

def test_invalid_engine_setting_rejected():
    set_env("octave")
    try:
        with pytest.raises(ea.EngineError): ea.single_sided_spectrum(tone(1000, FS), FS)
    finally: teardown_env()

def test_status_reports_without_starting_matlab_in_python_mode():
    teardown_env(); st = ea.status()
    assert st["configured_engine"] == "python" and st["matlab_available"] is None
