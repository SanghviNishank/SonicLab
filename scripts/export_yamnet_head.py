"""Export the trained MLP head from siren_yamnet_classifier.h5 to a plain NumPy .npz (needs only h5py + numpy, NOT TensorFlow).

    python scripts/export_yamnet_head.py path\\to\\siren_yamnet_classifier.h5 backend\\models\\siren_head.npz

Layout-agnostic: it collects every 2-D dataset (kernels) and 1-D dataset (biases) in the file and orders the kernels by
chaining shapes 1024 -> 256 -> 128 -> 1, so it works with both the legacy Keras-2 and the Keras-3 .h5 layouts.
Refuses to write anything if the shapes do not form exactly that chain. Records the SHA-256 of the source file.
"""
import hashlib, json, sys
from pathlib import Path
import numpy as np

CHAIN = (1024, 256, 128, 1)


def collect(path: Path):
    import h5py
    mats, vecs = [], []
    with h5py.File(path, "r") as f:
        def visit(name, obj):
            if isinstance(obj, h5py.Dataset) and obj.dtype.kind == "f":
                a = np.asarray(obj[()], dtype=np.float64)
                (mats if a.ndim == 2 else vecs if a.ndim == 1 else []).append((name, a))
        f.visititems(visit)
    return mats, vecs


def order(mats, vecs):
    W, B, used = [], [], set()
    for i_dim, o_dim in zip(CHAIN[:-1], CHAIN[1:]):
        k = [m for m in mats if m[1].shape == (i_dim, o_dim)]
        if len(k) != 1:
            raise SystemExit(f"expected exactly one kernel of shape {(i_dim, o_dim)}, found {len(k)}: {[m[0] for m in k]}")
        b = [v for v in vecs if v[1].shape == (o_dim,) and v[0].rsplit('/', 2)[0] == k[0][0].rsplit('/', 2)[0]] or \
            [v for v in vecs if v[1].shape == (o_dim,) and v[0] not in used]
        if not b:
            raise SystemExit(f"no bias of shape {(o_dim,)} found")
        used.add(b[0][0]); W.append(k[0][1]); B.append(b[0][1])
    return W, B


def main(src: str, dst: str):
    src_p = Path(src); mats, vecs = collect(src_p); W, B = order(mats, vecs)
    if not all(np.isfinite(a).all() for a in W + B):
        raise SystemExit("non-finite weights; refusing to export")
    np.savez(dst, W1=W[0], b1=B[0], W2=W[1], b2=B[1], W3=W[2], b3=B[2])
    meta = {"source_file": src_p.name, "source_sha256": hashlib.sha256(src_p.read_bytes()).hexdigest(), "shapes": [list(w.shape) for w in W],
            "architecture": "Dense(256,relu)-Dropout(inference: identity)-Dense(128,relu)-Dropout-Dense(1,sigmoid)",
            "input": "mean YAMNet embedding (1024), trained on UrbanSound8K clips (siren class 8 vs rest)"}
    Path(dst).with_suffix(".json").write_text(json.dumps(meta, indent=1))
    print("exported", dst, meta["shapes"])


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit(__doc__)
    main(sys.argv[1], sys.argv[2])
