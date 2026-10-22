# RoadSonic - Emergency Siren Detection in Noisy Traffic

**RoadSonic is an academic prototype. It reports *candidate* siren events from interpretable rules. It is not a trained classifier, not a confirmed-siren detector and not a safety-critical warning system.**

## 1. Abstract
RoadSonic analyses traffic recordings (WAV/FLAC/MP3/OGG/M4A/AIFF, mono or stereo), computes frame-level spectral features, and flags intervals in which a strong spectral peak persists and its frequency sweeps or alternates - the signature of many sirens - while rejecting steady horns, broadband traffic noise and (in tests) speech-like sounds. Results are shown on a waveform, FFT spectrum, spectrogram, feature tracks and an event timeline, with per-event evidence, playback, evaluation against user labels, and CSV/JSON/HTML/PDF export.

## 2. Problem statement and objectives
Detect possible emergency-siren intervals in noisy traffic audio in a transparent, reproducible way; expose why each interval was flagged; avoid overclaiming. Objectives: correct numerical features, interpretable rules with configurable thresholds, honest empty results, event timestamps tied to sample positions, and genuine tests including documented false positives and misses.

## 3. System architecture
```
React (RoadSonic dashboard, Plotly)  --HTTP/JSON-->  FastAPI routes  -->  services/roadsonic.py (orchestration)
                                                                     -->  processing/ (audio_io, filters, enhance, fft_analysis,
                                                                          spectrogram, siren_features, siren_detector)
```
Workflow: upload -> decode/validate -> channel mix (+ DC removal) -> optional filter / adaptive noise reduction -> frame features -> rule-based detection -> events + evidence -> plots, playback, evaluation, export. In-memory session store (TTL 1 h), no database.

## 4. Mathematics
- Time axis t[n] = n/fs. Frame m (length L, hop H) covers samples [mH, mH+L); its time stamp is the centre (mH + L/2)/fs.
- Single-sided amplitude spectrum: amp[k] = 2|X[k]|/sum(w) (DC/Nyquist not doubled), X = FFT(x w), Hann window, df = fs/Nfft. Zero-padding interpolates; resolution is set by duration.
- Features per frame (analysis band [f_lo, f_hi], Hann, zero-padded FFT, P = |X|^2): RMS (dBFS); centroid = sum(fP)/sum(P); bandwidth = sqrt(sum((f-c)^2 P)/sum(P)); spectral flatness = geometric mean / arithmetic mean of P (1 noise-like, ->0 tonal); dominant frequency = parabolic interpolation of the strongest bin; peak prominence = 10 log10(peak power / median band power); tonal ratio = energy in peak +/-2 bins / energy in a wider context band [100 Hz, min(1.5 f_hi, 0.45 fs)] (a peak on the band edge counts as non-tonal); zero-crossing rate.
- Adaptive noise reduction (optional): minimum-statistics noise tracking + decision-directed square-root Wiener gain.

## 5. Detector (defaults in `DetectorConfig`, bounds in `schemas/roadsonic_params.py`)
Frame rules: R1 level >= -60 dBFS; R2 tonal ratio >= 0.5; (optional R6 prominence). Window rules (1 s windows, 0.1 s step): R3 tonal fraction >= 0.6; R4 robust f0 range (p95-p5) >= 150 Hz; R5 f0 std >= 40 Hz. Passing windows merge when gaps <= 0.5 s; intervals are trimmed to their first/last tonal frame, clamped to the recording, kept if >= 1 s; optional maximum duration splits without overlap.
**Evidence score** = mean of tonal fraction, modulation (range / 3x threshold) and tonal strength, each clipped to [0,1]. It is a heuristic ranking, **not a probability** and not calibrated.
**Sensitivity presets** (low/medium/high) set the four main thresholds (tonal ratio, tonal fraction, f0 range, f0 std). Higher sensitivity admits weaker evidence: it finds more weak sirens *and* more false alarms.
Threshold justification: chosen from physical reasoning (a siren is tonal and sweeps; a horn is tonal and steady) and checked on the synthetic benchmark below. **They were not tuned on real recordings.**

## 6. Genuine test and benchmark results (synthetic signals only)
Command: `python scripts/roadsonic_benchmark.py` (full output: `docs/roadsonic_benchmark_output.txt`), fs = 16 kHz, 10 s fixtures with known truth.
| Fixture | low | medium | high |
|---|---|---|---|
| clean siren 600-1400 Hz, truth 3-7 s | found, 0.04 s error | found | found |
| siren + traffic-like noise (3 levels) | found | found | found |
| siren + white noise amp 0.2 / 0.5 | found / **missed** | found / found | found / found |
| weak siren (amp 0.01) + noise 0.2 | **missed** | **missed** | **missed** |
| narrow sweep 700-1000 Hz | found (0.2 s error) | found | found |
| fast "yelp" 700-1500 Hz, 3 sweeps/s | **missed** | found | found |
| two separate sirens | 2/2 | 2/2 | 2/2 |
| steady horn chord, steady tone, vibrato horn (6 Hz, +-30 Hz) | no event | no event | no event |
| slow 500->1500 Hz tone glide (not a siren) | no event | no event | **false alarm** |
| synthetic voiced speech + noise, traffic noise, white noise, silence | no event | no event | no event |
Also tested: sample rates 8/22.05/44.1/48 kHz; stereo (channel select, antiphase cancellation in the mono mix is a documented limitation); very short audio (10-2000 samples, no crash); volume x0.1 and x5 (same result); timestamps always inside [0, duration]; merge gap, minimum duration, maximum duration; filtering away the siren band loses the event (documented risk).
**Test counts** (this sandbox, local runner): see `docs/implementation_status.md`.

## 7. Evaluation
`POST /roadsonic/{job}/evaluate` and the Evaluation tab compute event-level TP/FP/FN, precision, recall, F1, boundary errors and false alarms per minute from intervals *you* label (greedy matching, IoU >= 0.3). With no labelled real recordings, **no real-world accuracy is claimed.** Tuning settings on the same recording inflates the numbers.

## 8. Candidate detection vs confirmed identification vs machine learning
Candidate detection (this system): fixed rules flag intervals that look siren-like. Confirmed identification: independent evidence that a siren really occurred (a human listening, a labelled reference). Trained ML classification: a model fitted to labelled data and evaluated on held-out recordings - **not implemented** (needs a licensed, source-separated dataset; none was used, so no trained-model accuracy exists).

## 9. Limitations
False positives: modulated horns, alarms, music, sliding tones, squealing brakes, some speech. Misses: distant/weak sirens, heavy noise, narrow or very fast sweeps at low sensitivity, sirens outside the search band. Mono mix can cancel antiphase content. Timestamps have frame resolution (+/-0.03 s plus window effects, tolerance used in tests 0.3-0.8 s). Filtering can remove siren harmonics; noise reduction is untested for detection benefit on real data.

## 10. MATLAB
Python/SciPy performs all RoadSonic computation. `matlab/` contains ClearVoice reference functions only; **no RoadSonic MATLAB function exists and MATLAB has never been executed** by the author. Results are labelled `python-numpy/scipy`.

## 11. Setup, API and demonstration
Setup: README. Endpoints: `GET /roadsonic/defaults`; `POST /roadsonic/{audio_id}/detect`; `GET /roadsonic/{job}/audio?version=original|processed`; `GET /roadsonic/{job}/event/{i}/audio?pre=&post=`; `POST /roadsonic/{job}/evaluate`; `GET /roadsonic/{job}/export?kind=events_csv|events_json|features_csv|config_json|results_json`; `GET /roadsonic/{job}/report?format=html|pdf`.
Demo script: (1) upload a synthetic siren (`scripts/make_demo_audio.py`); (2) show Overview tile values and the timeline; (3) Analysis: spectrogram with events, dominant-frequency track - point out the sweep; (4) Events: select #1, read the evidence and rule table, play with context; (5) change `min_f0_range_hz` to 4000 -> "settings changed", rerun -> empty result; Reset; (6) upload the horn demo -> no event; (7) enable a band-pass at 2500-3500 Hz with Compare -> the siren disappears from the processed version (filter risk); (8) Export CSV/HTML.

## 12. References (classic works; verify before citing)
Harris 1978 (windows for harmonic analysis); Oppenheim & Schafer, Discrete-Time Signal Processing; Ephraim & Malah 1984 (short-time spectral amplitude estimation); Martin 2001 (noise PSD estimation by minimum statistics).

## 13. Viva questions
1. *Why not threshold the dominant frequency alone?* Horns are tonal too; sirens additionally sweep (R4/R5).
2. *Why is the score not a probability?* It is uncalibrated; no labelled outcomes were used.
3. *Why can higher sensitivity be worse?* It admits weaker evidence: the slow-glide false alarm appears only at "high".
4. *What does the flatness feature do?* ~1 for noise, ~0 for a tone; a low value supports tonality.
5. *Why is the tonal ratio's denominator a wider band?* Low-pass road noise leaking into the band edge otherwise looked tonal (found and fixed by a test).
6. *Can filtering hurt?* Yes - a band-pass outside the siren band removes the evidence (tested).
7. *Is this machine learning?* No; fixed rules.
