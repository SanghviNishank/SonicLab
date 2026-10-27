"""Milestone 4: engine policy, structured engine info and cross-engine verification.

A FAKE engine (pure Python mimicking the four matlab/functions/*.m files, including their samples-by-channels
orientation) is injected. These tests prove selection logic, labelling, fallback policy, argument orientation and that
the verification service really detects a mismatch. They do NOT prove MATLAB numerics: run the MATLAB-side tests
(see docs/matlab_setup.md) on a machine with MATLAB.
"""
import os
import numpy as np
import pytest
from scipy import signal

from app.matlab import engine_adapter as ea
from app.processing import fft_analysis as fa, filters as flt
from app.services import engine_verification as ev
from synth import tone, noise

FS = 16000
BTYPE = {"low": "lowpass", "high": "highpass", "bandpass": "bandpass", "stop": "bandstop"}   # MATLAB butter type names


class FakeEng:
    """Mimics the MATLAB functions. `variance_ddof` and `fail` allow injecting a wrong/failed MATLAB."""
    def __init__(self, fail=False, variance_ddof=0):
        self.fail, self.ddof, self.calls, self.paths = fail, variance_ddof, [], []

    def addpath(self, p, nargout=0): self.paths.append(p)
    def version(self): return "FAKE R0000x"
    def _go(self, name):
        self.calls.append(name)
        if self.fail: raise RuntimeError("boom")

    def calculate_single_sided_spectrum(self, xs, fs, window, nfft, nargout=2):
        self._go("spectrum"); x = np.asarray(xs, float).ravel()
        s = fa.single_sided_spectrum(x, fs, window, None if nfft == [] else int(nfft))
        return s["freqs_hz"].reshape(-1, 1), s["amplitude"].reshape(-1, 1)

    def calculate_audio_statistics(self, xs, nargout=1):
        self._go("statistics"); x = np.asarray(xs, float)
        assert x.shape[0] > x.shape[1], "MATLAB expects samples-by-channels"
        return {"min": x.min(0).tolist(), "max": x.max(0).tolist(), "mean": x.mean(0).tolist(),
                "rms": np.sqrt((x ** 2).mean(0)).tolist(), "variance": x.var(0, ddof=self.ddof).tolist(),
                "peak_abs": np.abs(x).max(0).tolist()}

    def design_digital_filter(self, typ, order, cutoff, fs, nargout=1):
        self._go("filter_design")
        wn = np.asarray(cutoff, float).ravel() / (fs / 2)
        z, p, k = signal.butter(int(order), wn[0] if wn.size == 1 else wn, btype=BTYPE[typ], output="zpk")
        return signal.zpk2sos(z, p, k)

    def compare_signals(self, xs, ys, nargout=1):
        self._go("compare"); x, y = np.asarray(xs, float), np.asarray(ys, float)
        assert x.shape == y.shape and x.shape[0] > x.shape[1]
        return {"rms_before": np.sqrt((x ** 2).mean(0)).tolist(), "rms_after": np.sqrt((y ** 2).mean(0)).tolist(),
                "mse": ((x - y) ** 2).mean(0).tolist()}


class Clock:
    def __init__(self): self.t = 0.0
    def __call__(self): return self.t


def runner(eng=None, start_fails=False, clock=None):
    eng = eng or FakeEng(); starts = {"n": 0}
    class Me:
        @staticmethod
        def start_matlab():
            starts["n"] += 1
            if start_fails: raise OSError("no matlab")
            return eng
    class M:
        double = staticmethod(lambda v: v)
    kw = {"clock": clock} if clock else {}
    r = ea.MatlabRunner(lambda: (M, Me), **kw); r.starts = starts
    return r, eng


def env(mode, fb="none"):
    os.environ["CS_ENGINE"] = mode; os.environ["CS_ENGINE_FALLBACK"] = fb


def clear():
    os.environ.pop("CS_ENGINE", None); os.environ.pop("CS_ENGINE_FALLBACK", None)


def stereo():
    return np.stack([tone(440, FS, 1.0, 0.5) + noise(FS, 1, 0.01), tone(1500, FS, 1.0, 0.3)])


def test_python_mode_never_touches_matlab_and_reports_python():
    clear(); r, eng = runner()
    _, info = ea.statistics_info(stereo(), runner=r)
    assert info["engine_used"] == "python" and not info["fallback_used"] and eng.calls == [] and r.starts["n"] == 0


@pytest.mark.parametrize("op", ["spectrum", "statistics", "filter_design", "compare"])
def test_matlab_mode_runs_the_matlab_function_and_labels_matlab(op):
    r, eng = runner(); env("matlab")
    try:
        x = stereo()
        if op == "spectrum": _, info = ea.spectrum_info(x[0], FS, runner=r)
        elif op == "statistics": _, info = ea.statistics_info(x, runner=r)
        elif op == "filter_design": _, info = ea.filter_design_info("lowpass", 4, [1000.0], FS, runner=r)
        else: _, info = ea.compare_info(x, 0.5 * x, runner=r)
        assert info["engine_used"] == "matlab" and info["fallback_used"] is False and eng.calls == [op] and info["operation"] == op
    finally: clear()


@pytest.mark.parametrize("op", ["spectrum", "statistics", "filter_design", "compare"])
def test_matlab_required_and_unavailable_fails_visibly(op):
    r, _ = runner(start_fails=True); env("matlab", "none")
    try:
        x = stereo()
        with pytest.raises(ea.EngineError, match="MATLAB Engine unavailable"):
            if op == "spectrum": ea.spectrum_info(x[0], FS, runner=r)
            elif op == "statistics": ea.statistics_info(x, runner=r)
            elif op == "filter_design": ea.filter_design_info("lowpass", 4, [1000.0], FS, runner=r)
            else: ea.compare_info(x, 0.5 * x, runner=r)
    finally: clear()


def test_matlab_mode_with_explicit_fallback_and_auto_mode_report_the_fallback():
    for mode, fb in (("matlab", "python"), ("auto", "none")):
        r, _ = runner(start_fails=True); env(mode, fb)
        try:
            res, info = ea.statistics_info(stereo(), runner=r)
            assert info["engine_used"] == "python" and info["fallback_used"] is True and "no matlab" in info["fallback_reason"]
            assert "fallback" in ea.engine_label(info) and ea.engine_label(info) != "matlab"
            assert len(res["rms"]) == 2
        finally: clear()


def test_runtime_error_inside_matlab_names_the_function_and_is_not_silent():
    r, _ = runner(FakeEng(fail=True)); env("matlab", "none")
    try:
        with pytest.raises(ea.EngineError, match=r"MATLAB call failed \(calculate_audio_statistics\)"):
            ea.statistics_info(stereo(), runner=r)
    finally: clear()


def test_failed_start_is_cached_for_the_cooldown_then_retried():
    clock = Clock(); r, _ = runner(start_fails=True, clock=clock); env("auto")
    try:
        for _ in range(5): ea.statistics_info(stereo(), runner=r)
        assert r.starts["n"] == 1                     # not 5 slow start-up attempts
        clock.t += ea.FAIL_COOLDOWN_S + 1; ea.statistics_info(stereo(), runner=r)
        assert r.starts["n"] == 2
    finally: clear()


def test_matlab_results_are_converted_to_python_types_and_orientation_is_correct():
    r, _ = runner(); env("matlab")
    try:
        x = stereo(); st, _ = ea.statistics_info(x, runner=r)      # FakeEng asserts samples-by-channels
        assert st["rms"] == pytest.approx([np.sqrt(np.mean(c ** 2)) for c in x], abs=1e-12)
        cm, _ = ea.compare_info(x, 0.5 * x, runner=r)
        assert cm["mse"] == pytest.approx([np.mean((0.5 * c) ** 2) for c in x], abs=1e-12)
    finally: clear()


def test_filter_design_validates_before_calling_matlab_and_response_matches_design():
    r, eng = runner(); env("matlab")
    try:
        with pytest.raises(flt.FilterError):
            ea.filter_design_info("lowpass", 4, [FS / 2 + 1], FS, runner=r)
        assert eng.calls == [] and r.starts["n"] == 0
        out, info = ea.filter_design_info("bandpass", 4, [500.0, 1500.0], FS, "causal", 256, runner=r)
        ref = flt.frequency_response(flt.design_filter("bandpass", 4, [500.0, 1500.0], FS), FS, "causal", 256)
        assert np.max(np.abs(out["response"]["magnitude"] - ref["magnitude"])) < 1e-9 and out["sos"].shape[1] == 6
    finally: clear()


def test_invalid_engine_setting_rejected_for_every_operation():
    env("octave")
    try:
        with pytest.raises(ea.EngineError): ea.statistics_info(stereo())
        with pytest.raises(ea.EngineError): ea.compare_info(stereo(), stereo())
    finally: clear()


# ---- verification service ------------------------------------------------------------------------------------
def test_verification_passes_when_matlab_agrees_and_states_it_was_performed():
    r, _ = runner(); env("matlab")
    try:
        v = ev.verify_engines(stereo(), FS, runner=r)
        assert [o["operation"] for o in v["operations"]] == ["spectrum", "statistics", "filter_design", "compare"]
        assert all(o["comparison_performed"] and o["passed"] for o in v["operations"])
        assert v["summary"]["all_passed"] is True and v["summary"]["matlab_operations_compared"] == 4
    finally: clear()


def test_verification_detects_a_numerically_different_matlab():
    r, _ = runner(FakeEng(variance_ddof=1)); env("matlab")      # sample variance instead of population variance
    try:
        v = ev.verify_engines(stereo(), FS, runner=r)
        st = next(o for o in v["operations"] if o["operation"] == "statistics")
        assert st["passed"] is False and st["max_abs_diff"] > 1e-9 and v["summary"]["all_passed"] is False
    finally: clear()


def test_verification_does_not_claim_validation_when_matlab_did_not_run():
    clear(); v = ev.verify_engines(stereo(), FS)
    assert all(o["comparison_performed"] is False and o["passed"] is None for o in v["operations"])
    assert v["summary"]["all_passed"] is None and "nothing here validates MATLAB" in v["summary"]["note"]
    r, _ = runner(start_fails=True); env("auto")
    try:
        v = ev.verify_engines(stereo(), FS, runner=r)
        assert all(o["engine_info"]["fallback_used"] and not o["comparison_performed"] for o in v["operations"])
    finally: clear()


# ---- metrics service (what the filter/voice routes call) ---------------------------------------------------------
def test_metrics_service_python_mode_matches_comparison_module_and_is_labelled():
    from app.services import metrics_service as ms
    from app.processing import comparison as cp
    clear(); x = stereo(); y = 0.5 * x
    m, info = ms.compare_with_engine(x, y)
    ref = cp.compare_signals(x, y)
    assert info["engine_used"] == "python" and m["engine"] == "python-scipy"
    for a, b in zip(m["per_channel"], ref["per_channel"]):
        assert a["mse"] == pytest.approx(b["mse"], rel=1e-12) and a["rms_change_db"] == pytest.approx(b["rms_change_db"], abs=1e-9)


def test_metrics_service_matlab_mode_labels_matlab_and_rejects_misaligned_signals():
    from app.services import metrics_service as ms
    r, _ = runner(); env("matlab")
    try:
        x = stereo(); m, info = ms.compare_with_engine(x, 0.5 * x, runner=r)
        assert m["engine"] == "matlab" and info["engine_used"] == "matlab"
        assert m["per_channel"][0]["rms_change_db"] == pytest.approx(20 * np.log10(0.5), abs=1e-9)
        with pytest.raises(ValueError, match="not aligned"):
            ms.compare_with_engine(x, x[:, :-1], runner=r)
    finally: clear()
