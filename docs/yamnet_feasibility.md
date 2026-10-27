# YAMNet siren classifier: feasibility (Milestone 6)

## Verified by reading the repository (static inspection)
- Architecture: YAMNet (Apache-2.0, TF Hub) -> **mean embedding per clip** -> MLP 1024-256-128-1, sigmoid; trained on UrbanSound8K, siren class vs everything else.
- Preprocessing: `librosa.load(sr=16000, mono=True)`, float32, no extra normalisation.
- **Split defect:** `train_classifier.py` ignores UrbanSound8K's `fold` column and uses a random stratified 80/20 split over clips; clips cut from the same source recording can appear in train and test, and the validation split also drives early stopping. The README's ~95% is therefore **not a trustworthy estimate**, and it was not reproduced.
- **Distribution shift:** the head saw clip-mean embeddings (<=4 s). Per-frame (0.48 s hop) embeddings are a different input distribution, so `siren_model.py` averages 8 consecutive frames (4.32 s span) by default. This makes event boundaries coarse (seconds); measure before trusting them.
- Licence: no licence file in the repo; README lists YAMNet Apache-2.0 and says UrbanSound8K "requires citation". UrbanSound8K's own terms (to my knowledge non-commercial, verify) may apply to weights trained on it. Unresolved: confirm before redistribution.
- The `.h5` is Keras-3 format (config contains `batch_shape`, `DTypePolicy`); the repo's `tensorflow>=2.13` pin is probably too old to load it. Not verified.

## NOT verified (blocked in the authoring sandbox: no TensorFlow, h5py, network)
Loading the `.h5`, running YAMNet, real inference, accuracy, timing, memory, TFLite/ONNX equivalence.

## What was built
`scripts/export_yamnet_head.py` (h5py only) -> `backend/models/siren_head.npz`; `app/services/siren_model.py` (NumPy head, lazy TF-Hub backbone, window scoring, intervals, alignment with rule-based events, explicit `ModelUnavailable`); `GET /api/v1/roadsonic/model-status`. Tests use a test-double head and a fake backbone and validate plumbing only.

## Run on your machine
```powershell
python -m venv .venv-yamnet; .\.venv-yamnet\Scripts\Activate.ps1
pip install h5py numpy
python scripts\export_yamnet_head.py ..\Siren_detection_YAMNet-main\models\siren_yamnet_classifier.h5 backend\models\siren_head.npz
pip install "tensorflow>=2.16" tensorflow-hub     # large; do this in the isolated env first, record install size/time
# set CS_YAMNET_DIR to a local YAMNet SavedModel if you are offline
python -c "from app.services.siren_model import SirenModelService as S; print(S().status())"   # from backend\
```
Then: compare the exported head against the Keras model on random embeddings (max abs diff should be ~1e-6), run it on labelled recordings split **by source/fold**, and report precision/recall/F1/false-positive rate. Only then consider wiring it into detection.
