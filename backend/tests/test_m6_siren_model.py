"""Milestone 6: model-service plumbing, time alignment and honesty guarantees.

IMPORTANT: no real YAMNet and no real trained head are used here (TensorFlow, h5py and the network are not available in the
authoring sandbox). A hand-built TEST-DOUBLE head and a FAKE backbone exercise the code paths: resampling, frame geometry,
window averaging, thresholding, interval merging, alignment and failure handling. They prove NOTHING about model accuracy.
Real-model validation commands are in docs/yamnet_feasibility.md.
"""
import importlib.util
from pathlib import Path
import numpy as np
import pytest

from app.services import siren_model as sm
from synth import tone

ROOT = Path(__file__).resolve().parents[2]


def make_head(gain=10.0, bias=-5.0) -> sm.SirenHead:
    """Test double: score = sigmoid(relu(gain*e0) + bias) looks only at embedding component 0."""
    W1 = np.zeros((1024, 256)); W1[0, 0] = gain
    W2 = np.zeros((256, 128)); W2[0, 0] = 1.0
    W3 = np.zeros((128, 1)); W3[0, 0] = 1.0
    return sm.SirenHead([W1, W2, W3], [np.zeros(256), np.zeros(128), np.array([bias])])


class FakeBackbone:
    """Embedding component 0 is 1 for frames whose CENTRE lies in [a, b] seconds, else 0. Ignores audio content."""
    name = "FAKE backbone (test double)"
    def __init__(self, a=3.0, b=7.0): self.a, self.b = a, b
    def embeddings(self, w):
        n = int(np.floor((w.size / sm.YAMNET_SR - sm.FRAME_S) / sm.HOP_S)) + 1
        e = np.zeros((n, 1024))
        for i in range(n):
            c = i * sm.HOP_S + sm.FRAME_S / 2
            if self.a <= c <= self.b: e[i, 0] = 1.0
        return e


def service(tmp_path, backbone=None, head=None):
    p = tmp_path / "head.npz"; h = head or make_head()
    np.savez(p, W1=h.W[0], b1=h.b[0], W2=h.W[1], b2=h.b[1], W3=h.W[2], b3=h.b[2])
    return sm.SirenModelService(p, lambda: backbone or FakeBackbone())


# ---- head ---------------------------------------------------------------------------------------------------
def test_head_forward_matches_manual_numpy_and_outputs_are_in_unit_interval():
    rng = np.random.default_rng(0)
    W = [rng.standard_normal((1024, 256)) * 0.05, rng.standard_normal((256, 128)) * 0.1, rng.standard_normal((128, 1)) * 0.1]
    b = [rng.standard_normal(256) * 0.1, rng.standard_normal(128) * 0.1, rng.standard_normal(1) * 0.1]
    x = rng.standard_normal((5, 1024))
    h = np.maximum(x @ W[0] + b[0], 0); h = np.maximum(h @ W[1] + b[1], 0); ref = 1 / (1 + np.exp(-(h @ W[2] + b[2]).ravel()))
    out = sm.SirenHead(W, b).score(x)
    assert np.allclose(out, ref, atol=1e-12, rtol=0) and np.all((out > 0) & (out < 1))


def test_head_loading_rejects_missing_wrongshape_and_nonfinite(tmp_path):
    with pytest.raises(sm.ModelUnavailable, match="not found"): sm.SirenHead.load(tmp_path / "nope.npz")
    h = make_head(); bad = tmp_path / "bad.npz"
    np.savez(bad, W1=h.W[0][:, :255], b1=h.b[0][:255], W2=h.W[1], b2=h.b[1], W3=h.W[2], b3=h.b[2])
    with pytest.raises(sm.ModelUnavailable, match="shapes"): sm.SirenHead.load(bad)
    w1 = h.W[0].copy(); w1[0, 0] = np.nan; nan = tmp_path / "nan.npz"
    np.savez(nan, W1=w1, b1=h.b[0], W2=h.W[1], b2=h.b[1], W3=h.W[2], b3=h.b[2])
    with pytest.raises(sm.ModelUnavailable, match="non-finite"): sm.SirenHead.load(nan)
    (tmp_path / "junk.npz").write_bytes(b"not a zip")
    with pytest.raises(sm.ModelUnavailable, match="unreadable"): sm.SirenHead.load(tmp_path / "junk.npz")


def test_head_rejects_wrong_embedding_dimension_and_nan_input():
    with pytest.raises(ValueError): make_head().score(np.zeros((2, 512)))
    with pytest.raises(ValueError): make_head().score(np.full((1, 1024), np.nan))


# ---- audio preparation -----------------------------------------------------------------------------------------
def test_resampling_is_real_not_a_relabel():
    x = np.stack([tone(1000, 44100, 1.0, 0.5), tone(1000, 44100, 1.0, 0.5)])
    y = sm.to_16k_mono(x, 44100)
    assert abs(y.size - 16000) <= 1 and y.ndim == 1
    spec = np.abs(np.fft.rfft(y * np.hanning(y.size))); f = np.fft.rfftfreq(y.size, 1 / 16000)
    assert f[np.argmax(spec)] == pytest.approx(1000, abs=2)                 # content frequency preserved after resampling
    assert sm.to_16k_mono(tone(1000, 16000, 1.0), 16000).size == 16000


# ---- geometry and thresholding -----------------------------------------------------------------------------------
def test_frame_geometry_and_window_means():
    emb = np.random.default_rng(1).standard_normal((20, 1024))
    ws = sm.window_scores(emb, make_head(), k=8)
    assert len(ws["scores"]) == 13 and ws["window_span_s"] == pytest.approx(7 * 0.48 + 0.96)
    assert ws["spans_s"][0] == pytest.approx((0.0, 4.32)) and ws["spans_s"][-1] == pytest.approx((12 * 0.48, 12 * 0.48 + 4.32))
    mean3 = emb[3:11].mean(axis=0, keepdims=True)
    assert ws["scores"][3] == pytest.approx(make_head().score(mean3)[0], abs=1e-12)
    short = sm.window_scores(emb[:3], make_head(), k=8)                       # fewer frames than k -> use all
    assert len(short["scores"]) == 1 and short["frames_per_window"] == 3
    with pytest.raises(ValueError): sm.window_scores(np.zeros((0, 1024)), make_head())


def test_interval_conversion_merging_and_min_duration():
    def mk(scores): return {"scores": np.array(scores), "window_span_s": 0.96, "frames_per_window": 1,
                            "spans_s": [(i * .48, i * .48 + .96) for i in range(len(scores))]}
    ws = mk([.1, .9, .9, .1, .9, .1, .1, .1, .9])
    iv = sm.intervals_from_windows(ws, 0.5, merge_gap_s=0.5, min_duration_s=0.5)
    # windows 1,2,4 are adjacent/overlapping (gap <= 0 s) so they merge: (0.48, 1.44) U (0.96, 1.92) U (1.92, 2.88); window 8 is separate
    assert [(round(i["start_s"], 2), round(i["end_s"], 2)) for i in iv] == [(0.48, 2.88), (3.84, 4.8)]
    assert iv[0]["n_windows"] == 3 and iv[0]["max_score"] == pytest.approx(.9) and all("not a probability" in i["score_note"] for i in iv)
    assert sm.intervals_from_windows(ws, 0.5, merge_gap_s=0.5, min_duration_s=3.0) == []          # durations are 2.40 s and 0.96 s
    gap = mk([.9, .1, .1, .1, .9])                                                                   # spans (0,.96) and (1.92,2.88): gap 0.96 s
    assert len(sm.intervals_from_windows(gap, 0.5, merge_gap_s=0.5, min_duration_s=0.5)) == 2
    assert len(sm.intervals_from_windows(gap, 0.5, merge_gap_s=1.0, min_duration_s=0.5)) == 1


def test_alignment_reports_agreement_and_disagreement_without_inventing_a_combined_score():
    ml = [{"start_s": 3, "end_s": 7}, {"start_s": 20, "end_s": 22}]; rule = [{"start_s": 3.1, "end_s": 6.9}, {"start_s": 40, "end_s": 42}]
    a = sm.evidence_alignment(ml, rule)
    assert a["agreeing_pairs"][0]["overlap_s"] == pytest.approx(3.8) and a["ml_only"] == [1] and a["rule_only"] == [1]


# ---- end to end with test doubles: plumbing and measurable boundary resolution ---------------------------------------------
def test_end_to_end_plumbing_and_boundary_error_is_bounded_by_the_window_span(tmp_path):
    svc = service(tmp_path); x = np.zeros((1, 10 * 16000))
    r = svc.score(x, 16000, k=1)
    assert r["n_frames"] == 19 and r["resampled_to_hz"] == 16000 and "FAKE" in r["backbone"]
    iv = sm.intervals_from_windows(r, 0.5, 0.5, 0.5)
    assert len(iv) == 1
    err_s, err_e = abs(iv[0]["start_s"] - 3.0), abs(iv[0]["end_s"] - 7.0)
    assert err_s <= sm.FRAME_S and err_e <= sm.FRAME_S                      # k=1: error bounded by one YAMNet frame (0.96 s)
    r8 = svc.score(x, 16000, k=8); iv8 = sm.intervals_from_windows(r8, 0.5, 0.5, 0.5)
    assert r8["window_span_s"] == pytest.approx(4.32)                       # k=8: boundaries are smeared on the scale of seconds


def test_resampled_input_goes_through_the_same_path(tmp_path):
    r = service(tmp_path).score(np.zeros((2, 44100 * 5)), 44100, k=1)
    assert abs(r["audio_s_at_16k"] - 5.0) < 1e-3


# ---- honesty: failures are explicit, never replaced by something else ---------------------------------------------
def test_status_is_truthful_when_head_or_backbone_missing(tmp_path):
    s = sm.SirenModelService(tmp_path / "missing.npz", lambda: FakeBackbone()).status()
    assert s["ready"] is False and s["head_present"] is False and "not found" in s["reason"] and s["verified_end_to_end"] is False
    def no_backbone(): raise sm.ModelUnavailable("YAMNet backbone unavailable: cannot import tensorflow_hub (test)")
    svc = sm.SirenModelService(service(tmp_path)._head_path, no_backbone)
    st = svc.status()
    assert st["ready"] is False and st["head_present"] is True and "tensorflow_hub" in st["reason"]
    with pytest.raises(sm.ModelUnavailable): svc.score(np.zeros((1, 16000 * 3)), 16000)


def test_inference_errors_and_bad_shapes_raise_model_unavailable(tmp_path):
    class Boom:
        name = "boom"
        def embeddings(self, w): raise RuntimeError("oom")
    class Bad:
        name = "bad"
        def embeddings(self, w): return np.zeros((3, 512))
    x = np.zeros((1, 16000 * 3))
    with pytest.raises(sm.ModelUnavailable, match="inference failed"): service(tmp_path, Boom()).score(x, 16000)
    with pytest.raises(sm.ModelUnavailable, match="expected"): service(tmp_path, Bad()).score(x, 16000)
    with pytest.raises(ValueError): service(tmp_path).score(np.full((1, 16000 * 3), np.nan), 16000)


def test_service_module_never_imports_the_rule_based_detector():
    src = (ROOT / "backend" / "app" / "services" / "siren_model.py").read_text()
    assert "siren_detector" not in src and "siren_features" not in src            # no silent substitution is even possible


# ---- export script (layout-agnostic ordering) --------------------------------------------------------------------
def _export_module():
    spec = importlib.util.spec_from_file_location("export_yamnet_head", ROOT / "scripts" / "export_yamnet_head.py")
    m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


def test_export_orders_kernels_by_shape_chain_regardless_of_file_order():
    ex = _export_module(); rng = np.random.default_rng(2)
    mats = [("layers/dense_2/vars/0", rng.standard_normal((256, 128))), ("layers/dense_3/vars/0", rng.standard_normal((128, 1))),
            ("layers/dense_1/vars/0", rng.standard_normal((1024, 256)))]
    vecs = [("layers/dense_3/vars/1", np.zeros(1)), ("layers/dense_1/vars/1", np.zeros(256)), ("layers/dense_2/vars/1", np.zeros(128))]
    W, B = ex.order(mats, vecs)
    assert [w.shape for w in W] == [(1024, 256), (256, 128), (128, 1)] and [b.shape for b in B] == [(256,), (128,), (1,)]
    with pytest.raises(SystemExit): ex.order(mats[:2], vecs)                                   # missing kernel -> refuse
    with pytest.raises(SystemExit): ex.order(mats + [("x/vars/0", rng.standard_normal((1024, 256)))], vecs)   # ambiguous -> refuse
