# Implementation status (updated at milestone: reports + adapter + overlay)

Legend: **Verified** = executed here and passing. **Unverified** = code exists, not executed. **Open** = not done.

## Environment of verification (sandbox, no network)
Python 3.12.3, NumPy 2.4.4, SciPy 1.17.1, FFmpeg + reportlab + matplotlib + pypdf present. **Not installed here:** FastAPI, SoundFile, pytest, httpx, TypeScript/Node packages, MATLAB.

## Tests
`pytest`-style suites run through a local stand-in runner: **86 passed, 0 failed, 0 skipped**
(37 original numerical + 30 voice/audio-I/O + 7 reports + 2 store + 7 engine-adapter + 3 RoadSonic overlay/sample-rate/stereo).
Run for real on your machine with `pytest` (see README). `tests/test_api.py` (16 tests) is **unverified** (needs FastAPI).

| Feature | Status |
|---|---|
| Statistics, FFT calibration, STFT, Butterworth filters, comparison | Verified |
| Multi-format decode (WAV/FLAC/OGG/AIFF/MP3/M4A via FFmpeg path), validation, encode float32/pcm16 | Verified (FFmpeg path); SoundFile path unverified |
| Voice pipeline, 7 presets, quality checks, spectral gating | Verified (synthetic signals only) |
| HTML + PDF reports (ClearVoice, RoadSonic): real values, HTML escaping, PDF text/page breaks | Verified (builders/renderers); HTTP routes unverified |
| Engine adapter (python default, matlab, explicit fallback, labelling) | Verified with a FAKE engine; **MATLAB itself unverified** |
| RoadSonic detector, event/spectrogram time alignment, 8/22.05/44.1/48 kHz, mono-mix cancellation limitation | Verified (synthetic) |
| Session history list, delete audio, report routes, voice route, spectrogram CSV | Implemented, unverified (routes) |
| React frontend (all pages, voice panel, event overlay, report links) | Implemented, **never built or viewed** |
| MATLAB functions + `compare_with_python.m` | Implemented, **never executed** |

## Open
Premium redesign (design tokens exist only in a basic form), mobile bottom navigation, frontend tests, A/B synchronized playback and gain-matched listening, resizable panels, output-sample-rate selection, threshold-tuning experiments on real recordings, ML extension (no licensed dataset used), screenshots, final end-to-end run.
