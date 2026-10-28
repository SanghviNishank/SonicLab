# SonicSense engineering audit, defect log and verification (this iteration)

Environment: Linux x86_64, 2 CPUs, Python 3.13.17, NumPy 2.5.3, SciPy 1.18.1, FastAPI 0.162, SoundFile 0.14, pytest 9.1, Node 22, Chromium (Playwright). **MATLAB: not installed.**
Status words: **tested-pass**, **tested-fail**, **not tested**, **blocked** (environment).

## A. Repository audit (what was inspected)
Backend (`app/processing`, `services`, `schemas`, `api/routes.py`, `matlab/engine_adapter.py`), 15 test files, MATLAB `.m` files, the full React/Vite frontend (16 routed steps, session context, A/B player, charts), scripts, docs, README.
Architecture: upload -> magic-byte sniff -> decode (SoundFile / scipy / FFmpeg) -> float64 `(channels, samples)` -> in-memory TTL store -> analysis / filter / voice / RoadSonic services -> JSON (+ display-decimated waveforms) -> downloads encoded on demand. Numerical code is independent of HTTP handlers (already the case).
Important context: the previous iterations were written **without FastAPI, pytest, SoundFile, Node or a browser** (see `DEVELOPMENT_LOG.md`). This is the first run under real pytest, a real TypeScript build and a real browser.

## B. Confirmed root causes (reproduced before fixing)
| # | Defect | Where | Reproduction | Fix | Regression test |
|---|---|---|---|---|---|
| 1 | **Any recording longer than ~95 s (44.1 kHz) / 87 s (48 kHz) could not be analysed, filtered or voice-processed: HTTP 422 "n_fft exceeds safe maximum"**, although the documented limit is 300 s. `filter` and `voice` call the analysis, so the filter never ran. | `fft_analysis.single_sided_spectrum` (n_fft defaulted to record length, cap 2^22) | 277 s stereo 16-bit upload (46.6 MB, accepted) -> `/analyze`, `/filter` 422 | Segment-averaged single-sided spectrum for long records; response states `method`, `n_segments`, resolution; MATLAB-configured runs are labelled as Python-computed for these records | `test_long_recordings.py` (6 tests: tone frequency/amplitude, tail-only tone, API at 100 s: passband +-1 %, stopband >= 60 dB) |
| 2 | `/voice` `overrides` was a free-form dict: `{"rumble":5}`, `cutoff_hz:null`, bad `noise_segment_s` -> **HTTP 500**; misspelled stage names and `method:"x"` **silently ignored** (a setting never applied) | `routes.VoiceReq` | `probe_adv` script (10 malformed bodies) | Strict pydantic schema `schemas/voice.py` (unknown keys rejected, bounds, only sent fields merged onto the preset) | `test_hardening.py` (10 parametrised cases + a merge test that measures a 40 Hz rumble removed >34 dB and a 1 kHz tone kept within 1 %) |
| 3 | Filter `order: true` accepted as order 1; `cutoff_hz` list unbounded | `FilterReq` | API probe | Strict int with bounds; `max_length=2` | `test_hardening.py` |
| 4 | Upload 500 response echoed the exception text (information leak); logged filename not sanitised | `routes.upload` | code review + test with a fake exception | Generic message with an error id; `%r` logging; global handler for all other unhandled errors | `test_hardening.py` (2 tests) |
| 5 | Upload decode (up to a 120 s FFmpeg subprocess) ran **on the async event loop**, stalling all requests | `routes.upload` | code review | Decode in the threadpool | `test_busy_server...` |
| 6 | No limit on concurrent heavy work; no pre-parse request-size guard (multipart bodies are spooled to disk before the handler runs) | `main.py`, `routes.py` | code review | `core/limits.py` gate (503 + `Retry-After`), `Content-Length` guard (413) | `test_hardening.py` (4 tests) |
| 7 | Memory: per stored result ~14 B/sample/channel (float64 signal + float32 WAV + eager 16-bit WAV); store limited by item count only (50), i.e. unbounded in bytes | `routes.filter_audio/voice`, `store.py` | benchmark: +66 MB per extra job at 60 s stereo | Store processed signal once as float32; encode on demand; byte-budgeted LRU store counting shared arrays once | `test_hardening.py` (3 tests incl. bit-identical download) |
| 8 | Transient memory: decode made a transposed copy; Wiener/gate/VAD materialised several full-size complex/frames arrays; scipy `stft/istft` needs ~3x the STFT size | `audio_io`, `enhance`, `voice`, `vad` | `tracemalloc` per stage at 277 s stereo | Block-wise decode; in-place/early-free; chunked bit-exact STFT (`stft_lean.py`); strided VAD frames; `lfilter` instead of per-frame Python loops | `test_optimizations.py` (15 tests vs reference formulations) |
| 9 | `npm ci` fails: `package-lock.json` out of sync (missing three, framer-motion, lucide-react); `tsc` fails: no `@types/node` for the logic test | `frontend/` | `npm ci`, `npm run build` | Lockfile regenerated, `@types/node` added; build now passes | `npm run build`, `npm run test:logic` |
| 10 | Frontend showed raw JSON for FastAPI validation errors | `api.ts` | code review | `formatDetail` (pure, tested) | `logic.test.ts` |
| 11 | 3 existing tests failed under real pytest: two used a helper that turned `(n,2)` stereo into 64000 channels (**test defect**); one predated the default-on peak guard (**stale test**; product behaviour was correct) | `tests/test_api.py` | first real run: 278 passed, 3 failed | Tests corrected (guard disabled in the refusal test + new positive case) | same tests |

**Not a defect (checked, ruled out):** the filter core. Controlled stereo signals through the real HTTP API (upload -> filter -> downloaded WAV) for all four types and both methods: intended tones attenuated, other channel untouched, length/rate preserved, no resampling. 240-point numerical validation: 0 failures (`docs/filter_validation_report.md`). Browser check (Chromium): the processed player loads the *processed* file, 3 kHz tone 0.300 -> 0.00003 (-80 dB) after a 1 kHz low-pass, the original player is unchanged, float32 WAV decodes in the browser, 0 console errors.
So the likely reasons a real recording "does not sound filtered" are (a) failure #1 for long recordings, (b) a classical filter cannot remove noise overlapping the wanted band, (c) A/B levels are not matched. The UI already says (b) and (c).

## C. Tests (exact commands and results)
- `cd backend && python -m pytest -q` -> **322 passed, 0 failed, 0 skipped** (baseline at start: 278 passed, 3 failed).
- `cd frontend && npm run test:logic` -> 10 passed, 0 failed. `npm run build` -> passes (tsc + vite).
- `cd backend && python ../scripts/filter_validation.py` -> 240 checks, 0 failures.
- `python scripts/roadsonic_evaluate.py` reproduced the documented synthetic results on the new environment.
- Browser workflow (Playwright, upload -> filter -> A/B compare -> results/downloads): passed. Not scripted into the repo.

## D. Performance (`docs/perf/benchmark_before.json`, `benchmark_after.json`; `scripts/benchmark_backend.py`)
Same machine, fresh process per scenario, synthetic signals, seed 12345. RTF = processing seconds / audio seconds.
| Scenario (peak RSS, whole process) | before | after |
|---|---|---|
| 60 s stereo 44.1 kHz | 1161 MB | 812 MB |
| 277 s stereo 44.1 kHz (size limit) | 3805 MB | 2461 MB |
| RSS growth per extra stored filter job, 60 s / 277 s | 66 / 186 MB | 12 / 75 MB |
Per-stage peak at 277 s stereo (`tracemalloc`, above baseline): Wiener 1679 -> 933 MB, gate 1679 -> 856 MB, VAD 652 -> 373 MB, full voice pipeline 1959 -> 1213 MB, voice time 22.1 -> 17.7 s. Real-time factors stay 0.006-0.07. Optimised outputs equal the originals within 2.2e-16 (filtering and decoding bit-exact).
Honest limits: whole-process peak at the limit is still ~2.5 GB (benchmark client, request/response copies and the 195 MB decoded input are included); hard per-request timeouts are **not** possible for in-flight Python threads, so concurrency is bounded and the running time is bounded by the input limits instead.

## E. RoadSonic
Rule-based candidate detector; synthetic evaluation (22 fixtures: silence, noise, traffic, horns, beepers, speech-like, melody, volumes 0.02-1.0, SNR sweep) reproduced: medium sensitivity 11/11 events, 0 false alarms, mean boundary error ~0.04 s; high sensitivity flags a slow glide (documented false alarm); missed below about -3 dB SNR at medium. **Synthetic only; no real-world accuracy claim.** No ML classifier (no licensed dataset).

## F. MATLAB
**Blocked by environment:** no MATLAB, no Engine for Python here. Python/MATLAB cross-check, `matlab/tests/run_tests.m` and `compare_with_python.m` were **not executed**; the adapter is unit-tested only with a fake engine. Results are always labelled with the engine that actually computed them.

## G. Remaining issues / next steps
1. Run `compare_with_python.m` on a machine with MATLAB + Signal Processing Toolbox.
2. Evaluate RoadSonic and the voice pipeline on real, licensed recordings; thresholds were tuned on synthetic signals.
3. The Plotly bundle makes the main JS chunk 5 MB (1.5 MB gzip): switch to `plotly.js-cartesian-dist-min` and lazy-load charts.
4. Add the Playwright workflow to the repo as an automated test.
5. A hard per-request timeout needs a process pool; not done.
6. Conventional filters cannot isolate one speaker from overlapping speech; that needs source separation (not implemented, not claimed).
