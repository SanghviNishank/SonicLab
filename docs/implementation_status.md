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


## Update: voice-enhancement correction (this iteration)
Verified (sandbox): 110 tests pass (87 uploaded-state + 23 new: VAD 7, Wiener/gate/guard/preset 16). New: `vad.py`, `enhance.py`, `lecture_speech` preset, `peak_guard` (default on), strict MPEG sniffing, WAV truncation check restored, `scripts/analyze_and_process.py`.
Measured on synthetic speech + white noise only: lecture_speech improves SNR vs the known clean signal by about 6-9 dB (input 11.3/7.8/3.4/-2.6 dB -> 17.6/15.4/12.0/6.8 dB). VAD finds all four known intervals at 13 dB and 5 dB input SNR, fails at about -7 dB (documented test), and flags sustained periodic music as speech-like (documented test).
Unverified: frontend changes (advanced panel, reset, processing time) - not built here; the 2 new API tests (need FastAPI); MATLAB.
Found during testing: the synthetic `speech_like` generator has 28 % of its energy below 70 Hz (DC amplified by the tilt filter), which made a rumble high-pass look harmful; `speech_like_realistic` removes it. Earlier synthetic SNR figures that used plain gating without a high-pass are unaffected.


## Update: RoadSonic completion (this iteration)
Sandbox run (local pytest-style runner): **147 passed 0 failed** (110 inherited + new RoadSonic tests: detector/trajectory/clamping/max-duration/merge/sensitivity/evaluation, service orchestration, benchmark-derived limits, report content).
**Verified (executed here):** features (flatness, prominence, frame/hop/time axes), detector rules and edge cases, evaluation metrics, preprocessing + comparison + clip logic (service layer), payload size bounds, benchmark (`scripts/roadsonic_benchmark.py`), report HTML/PDF content.
**Implemented, NOT executed here:** pydantic request validation (`schemas/roadsonic.py` - pydantic not installed in the sandbox), the new FastAPI routes and their 9 new API tests in `tests/test_api.py` (run `pytest` on your machine), and the whole React RoadSonic dashboard (no TypeScript/npm available here; only a bracket-balance check was run). **Expect to fix small TypeScript errors on first `npm run build`.**
**Not implemented:** ML classifier (no licensed dataset), RoadSonic MATLAB functions / MATLAB cross-check, annotated full-length WAV, frontend automated tests (vitest not added), screenshots.
