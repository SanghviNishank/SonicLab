# Development log (Milestones 3-6)

Environment of the author's runs: Linux sandbox, Python 3.12, NumPy/SciPy only; **no FastAPI, pytest, soundfile, TensorFlow, MATLAB or network**. Tests were run with a minimal stand-in runner, not real pytest. `tests/test_api.py` and the frontend build were NOT run. Re-run everything on Windows: `cd backend; python -m pytest -q`.

## M3 ClearVoice DSP
Probed with known signals. Correct as-is: STFT/ISTFT identity (1.7e-16, length preserved), filter gain vs designed response, pole stability near Nyquist. Defects fixed in `fft_analysis.find_spectral_peaks` (tests fail on the old code): (1) DC offset produced a spurious ~0.5 Hz peak (amplitude 1.76 for a 0.5 offset); (2) amplitude estimate biased up to +0.32 dB, now <= 0.06 dB (window-kernel correction). Tests: `tests/test_m3_dsp_validation.py`. ML denoiser: licence/Windows research only (DeepFilterNet README states MIT/Apache-2.0, needs PyTorch); **not integrated**, install unverified.
## M4 MATLAB
`app/matlab/engine_adapter.py` (python/matlab/auto, `engine_info`, failure cooldown, 4 operations), `app/services/engine_verification.py`, `metrics_service.py`, routes: engine info on analyze/filter-preview/filter/voice, new `engine-verification`. `matlab/tests/*` extended (+`evaluate_sos_response.m`). Tests: `tests/test_m4_engine.py` use a FAKE MATLAB; **no MATLAB code was executed**. Shadow-check of the new MATLAB test formulas in NumPy only.
## M5 RoadSonic
Detector unchanged (no evidence it needs changes). 22 deterministic synthetic fixtures + manifest, evaluation script, `docs/roadsonic_evaluation.md`, tests `tests/test_m5_roadsonic.py`. Synthetic and optimistic by construction.
## M6 YAMNet
See `docs/yamnet_feasibility.md`. Model not run; ML not wired into detection.
## Not done
Frontend changes (no `node_modules`, build not run), ML speech enhancement, real-recording evaluation, MATLAB execution, API-level tests of the new routes.
