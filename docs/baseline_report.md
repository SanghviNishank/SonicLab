# Baseline and progress report

## Baseline (uploaded `signalsystem.zip`, identical to the delivered scaffold)
| Area | Status |
|---|---|
| Numerical core (stats, FFT, STFT, filters, comparison, RoadSonic) | **Verified**: 37/37 tests passed in the sandbox |
| FastAPI routes + `tests/test_api.py` | Written; **not executed** (FastAPI/httpx not installable offline) |
| React/Vite/TypeScript frontend | Written; **not built** (no node_modules, no network), never viewed in a browser |
| MATLAB functions + test | Written; **not executed** (no MATLAB here) |
| Reports (HTML/PDF), spectrogram event overlay, A/B sync playback, mobile nav, academic docs | Missing |

## Investigation of "voice is not filtered properly"
Reproduced on a synthetic voiced-speech signal + 30/50 Hz rumble at 16, 44.1 and 48 kHz with an 80 Hz 4th-order high-pass:
rumble cut 21.4 dB (causal) / 38.0 dB (zero-phase), speech band (300-3000 Hz) change 0.00 dB, output finite, correct length.
=> **No numerical defect found in the filter design/application**. Candidate causes that remain (unverified, need your recording):
1. A plain filter cannot remove broadband noise/hiss inside the speech band (expectation vs. method) -> new voice pipeline with spectral gating.
2. The only export was 32-bit-float WAV, which some players/editors handle badly -> 16-bit PCM export added (refused if it would clip).
3. UI defaults (e.g. 1-3 kHz band-pass) make speech sound thin -> presets with documented parameters.
4. Browser/WebGL chart or playback problems -> not testable here.

## Changes in this iteration
- `audio_io.py`: format sniffing from magic bytes; decode chain SoundFile -> scipy (WAV) -> FFmpeg; WAV, FLAC, OGG, AIFF, MP3, M4A tested end to end with FFmpeg-generated files; >2 channels, truncated/corrupt, oversize and non-audio rejected; `encode_wav(float32|pcm16)` with counted clipping.
- `voice.py`: stages (DC removal, rumble high-pass, band limit, spectral-gating noise reduction, peak-limited gain), 7 presets, history, quality checks (silent/NaN/clipping/level loss).
- API: `/clearvoice/presets`, `/clearvoice/{id}/voice`, `?subtype=pcm16`, `export?kind=history|spectrogram_original|spectrogram_filtered`, health reports decoder availability.
- Frontend: multi-format picker, voice panel, quality/history table, SVG `scatter` instead of `scattergl` (avoids WebGL-context limits with many charts), theme-reactive plots, chart overflow fix. **Unbuilt and unviewed.**

## Measured noise-reduction results (synthetic only)
Synthetic voiced speech with 0.8 s noise-only lead-in, white noise, noise segment supplied; SNR vs. the known clean signal:
| input SNR | strength 0.4 / 12 dB | 0.7 / 20 dB | 1.0 / 30 dB |
|---|---|---|---|
| 14.2 dB | 15.7 | 15.9 | 15.8 |
| 8.1 dB | 13.2 | 14.0 | 14.0 |
| 2.1 dB | 9.2 | 10.9 | 11.2 |
This is stationary white noise and a synthetic voice: it does **not** establish quality on real speech or non-stationary noise.

## Tests (sandbox, actual)
67 passed, 0 failed, 0 skipped (37 original + 30 new: voice 15, audio I/O 15). API tests (incl. 5 new) compiled but not run.

## Still open (prioritised)
1. Run backend API tests and `npm run build` on the Windows machine; fix what breaks.
2. Inspect the real charts in a browser (the "graphs not displaying" report is unconfirmed).
3. HTML/PDF reports; spectrogram event overlay; synchronized A/B playback.
4. Premium UI redesign, mobile bottom navigation, frontend tests.
5. MATLAB execution/adapter; academic documents.
