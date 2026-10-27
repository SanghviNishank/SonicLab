"""Optional YAMNet-based siren scoring for RoadSonic (ML evidence, kept separate from the rule-based detector).

Pipeline:  waveform -> real resampling to 16 kHz mono -> YAMNet backbone (frames of 0.96 s every 0.48 s, 1024-d embeddings)
           -> mean of K consecutive embeddings (training used one MEAN embedding per <=4 s UrbanSound8K clip)
           -> NumPy MLP head 1024-256-128-1 with the learned weights (exported by scripts/export_yamnet_head.py)
           -> per-window score -> candidate intervals.
Honesty rules enforced here:
  * No weights file or no backbone  ->  ModelUnavailable (with the reason). Never random weights, never a silent
    substitution by the rule-based detector; the caller decides what to do and must report it.
  * Sigmoid outputs are UNCALIBRATED scores, not probabilities.
  * Window averaging makes boundaries coarse: a window of K frames spans (K-1)*0.48 + 0.96 s. Interval edges are therefore
    only as precise as that span; use evidence_alignment() to compare with the rule-based events instead of trusting edges.
YAMNet frame geometry (documented model parameters): window 0.96 s, hop 0.48 s; frame i covers [0.48 i, 0.48 i + 0.96].
"""
from __future__ import annotations
import math, os, threading
from pathlib import Path
from typing import Protocol
import numpy as np
from scipy.signal import resample_poly

YAMNET_SR = 16000
FRAME_S, HOP_S = 0.96, 0.48
EMB_DIM = 1024
CHAIN = (1024, 256, 128, 1)
DEFAULT_HEAD = Path(__file__).resolve().parents[2] / "models" / "siren_head.npz"


class ModelUnavailable(RuntimeError):
    """The ML model cannot run; `reason` says why. Never converted into a result."""


class Backbone(Protocol):
    name: str
    def embeddings(self, waveform_16k: np.ndarray) -> np.ndarray: ...      # -> (frames, 1024)


class SirenHead:
    def __init__(self, W: list[np.ndarray], b: list[np.ndarray]):
        shapes = [w.shape for w in W]
        if shapes != [(CHAIN[i], CHAIN[i + 1]) for i in range(3)] or [v.shape for v in b] != [(c,) for c in CHAIN[1:]]:
            raise ModelUnavailable(f"head weights have shapes {shapes}, expected {[(CHAIN[i], CHAIN[i + 1]) for i in range(3)]}")
        if not all(np.isfinite(a).all() for a in W + b):
            raise ModelUnavailable("head weights contain non-finite values")
        self.W = [np.asarray(w, dtype=np.float64) for w in W]; self.b = [np.asarray(v, dtype=np.float64) for v in b]

    @classmethod
    def load(cls, path: str | Path) -> "SirenHead":
        p = Path(path)
        if not p.is_file():
            raise ModelUnavailable(f"head weights not found at {p} (run scripts/export_yamnet_head.py on the .h5 file)")
        try:
            z = np.load(p)
            return cls([z["W1"], z["W2"], z["W3"]], [z["b1"], z["b2"], z["b3"]])
        except ModelUnavailable:
            raise
        except Exception as e:
            raise ModelUnavailable(f"head weights unreadable: {type(e).__name__}: {e}") from None

    def score(self, emb: np.ndarray) -> np.ndarray:
        """emb (n, 1024) -> sigmoid output (n,). Dropout layers are identity at inference."""
        x = np.atleast_2d(np.asarray(emb, dtype=np.float64))
        if x.shape[1] != EMB_DIM or not np.isfinite(x).all():
            raise ValueError(f"embeddings must be finite with shape (n, {EMB_DIM})")
        h = np.maximum(x @ self.W[0] + self.b[0], 0.0)
        h = np.maximum(h @ self.W[1] + self.b[1], 0.0)
        z = (h @ self.W[2] + self.b[2]).ravel()
        return 1.0 / (1.0 + np.exp(-np.clip(z, -60, 60)))


class TfHubYamnet:
    """Real YAMNet via TensorFlow + TensorFlow Hub (or a local SavedModel directory in CS_YAMNET_DIR). Imported lazily."""
    name = "yamnet (TensorFlow Hub)"

    def __init__(self, source: str | None = None):
        try:
            import tensorflow_hub as hub  # noqa
        except Exception as e:
            raise ModelUnavailable(f"YAMNet backbone unavailable: cannot import tensorflow_hub ({type(e).__name__}: {e})") from None
        try:
            self._m = hub.load(source or os.getenv("CS_YAMNET_DIR") or "https://tfhub.dev/google/yamnet/1")
        except Exception as e:
            raise ModelUnavailable(f"YAMNet could not be loaded ({type(e).__name__}: {e}); offline? set CS_YAMNET_DIR to a local copy") from None

    def embeddings(self, waveform_16k: np.ndarray) -> np.ndarray:
        _, emb, _ = self._m(waveform_16k.astype(np.float32))
        return np.asarray(emb.numpy(), dtype=np.float64)


def to_16k_mono(x: np.ndarray, fs: float) -> np.ndarray:
    """(channels, samples) or 1-D -> mono float64 at 16 kHz by real polyphase resampling (never just relabelling fs)."""
    x = np.asarray(x, dtype=np.float64)
    mono = x if x.ndim == 1 else x.mean(axis=0)
    if int(round(fs)) != YAMNET_SR:
        g = math.gcd(int(round(fs)), YAMNET_SR)
        mono = resample_poly(mono, YAMNET_SR // g, int(round(fs)) // g)
    return mono


def frame_span_s(i: int) -> tuple[float, float]:
    return i * HOP_S, i * HOP_S + FRAME_S


def window_scores(emb: np.ndarray, head: SirenHead, k: int = 8) -> dict:
    """Mean of k consecutive frame embeddings per window (clips shorter than k frames use all frames)."""
    n = emb.shape[0]
    if n == 0:
        raise ValueError("backbone returned no frames (recording shorter than one YAMNet window?)")
    k = max(1, min(k, n))
    starts = np.arange(0, n - k + 1)
    cs = np.concatenate([np.zeros((1, emb.shape[1])), np.cumsum(emb, axis=0)])
    means = (cs[starts + k] - cs[starts]) / k
    spans = [(frame_span_s(int(s))[0], frame_span_s(int(s) + k - 1)[1]) for s in starts]
    return {"scores": head.score(means), "spans_s": spans, "frames_per_window": k,
            "window_span_s": (k - 1) * HOP_S + FRAME_S}


def intervals_from_windows(ws: dict, threshold: float = 0.5, merge_gap_s: float = 0.5, min_duration_s: float = 1.0) -> list[dict]:
    """Union of the spans of windows with score >= threshold, merged across gaps <= merge_gap_s, minimum duration applied."""
    iv: list[list] = []
    for sc, (a, b) in zip(ws["scores"], ws["spans_s"]):
        if sc >= threshold:
            if iv and a - iv[-1][1] <= merge_gap_s:
                iv[-1][1] = max(iv[-1][1], b); iv[-1][2].append(float(sc))
            else:
                iv.append([a, b, [float(sc)]])
    return [{"start_s": a, "end_s": b, "duration_s": b - a, "max_score": max(s), "mean_score": float(np.mean(s)), "n_windows": len(s),
             "label": "candidate siren event (ML score)", "score_note": "uncalibrated sigmoid output, not a probability",
             "boundary_resolution_note": f"boundaries come from {ws['window_span_s']:.2f} s windows; expect errors of that order"}
            for a, b, s in iv if b - a >= min_duration_s]


def evidence_alignment(ml: list[dict], rule: list[dict]) -> dict:
    """Which ML intervals overlap which rule-based events (no combined score is invented)."""
    def ov(a, b): return max(0.0, min(a["end_s"], b["end_s"]) - max(a["start_s"], b["start_s"]))
    both = [(i, j, ov(m, r)) for i, m in enumerate(ml) for j, r in enumerate(rule) if ov(m, r) > 0]
    return {"agreeing_pairs": [{"ml_index": i, "rule_index": j, "overlap_s": o} for i, j, o in both],
            "ml_only": [i for i in range(len(ml)) if all(i != p[0] for p in both)],
            "rule_only": [j for j in range(len(rule)) if all(j != p[1] for p in both)]}


class SirenModelService:
    """Lazy, thread-safe. The backbone factory is injectable so tests never need TensorFlow."""
    def __init__(self, head_path: str | Path | None = None, backbone_factory=None):
        self._head_path = Path(head_path or os.getenv("CS_SIREN_HEAD", DEFAULT_HEAD))
        self._factory = backbone_factory or TfHubYamnet
        self._lock = threading.Lock(); self._head = None; self._bb = None

    def _ensure(self):
        with self._lock:
            if self._head is None:
                self._head = SirenHead.load(self._head_path)
            if self._bb is None:
                self._bb = self._factory()
        return self._head, self._bb

    def status(self) -> dict:
        """Cheap readiness report that does not run inference. `verified_end_to_end` is only true after a real score() succeeded."""
        out = {"head_file": str(self._head_path), "head_present": self._head_path.is_file(), "ready": False, "reason": None,
               "verified_end_to_end": getattr(self, "_verified", False),
               "licence_note": "YAMNet: Apache-2.0. Head weights were trained on UrbanSound8K (dataset terms to be confirmed, see docs)."}
        try:
            self._ensure(); out["ready"] = True; out["backbone"] = getattr(self._bb, "name", "unknown")
        except ModelUnavailable as e:
            out["reason"] = str(e)
        return out

    def score(self, x: np.ndarray, fs: float, k: int = 8) -> dict:
        head, bb = self._ensure()
        wav = to_16k_mono(x, fs)
        if not np.isfinite(wav).all():
            raise ValueError("non-finite samples")
        try:
            emb = bb.embeddings(wav)
        except Exception as e:
            raise ModelUnavailable(f"YAMNet inference failed: {type(e).__name__}: {e}") from None
        if emb.ndim != 2 or emb.shape[1] != EMB_DIM:
            raise ModelUnavailable(f"backbone returned embeddings of shape {emb.shape}, expected (frames, {EMB_DIM})")
        ws = window_scores(emb, head, k)
        self._verified = True
        return {**ws, "n_frames": int(emb.shape[0]), "backbone": getattr(bb, "name", "unknown"), "resampled_to_hz": YAMNET_SR,
                "audio_s_at_16k": wav.size / YAMNET_SR}
