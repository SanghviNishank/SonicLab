# RoadSonic - technical documentation

## Abstract
RoadSonic marks candidate emergency-siren intervals in traffic audio using interpretable rules over frame features. It is an academic prototype, not a certified or safety-critical system, and it is **not machine learning**.

## Objectives and scope
Extract features, detect candidate events with visible evidence, overlay them on the waveform and spectrogram, play and export them.

## Architecture / workflow
upload -> decode -> mono mix (explicit, recorded) -> optional DC removal -> frame features (64 ms Hann frames, 16 ms hop) -> window rules -> merged, trimmed events -> timeline, spectrogram overlay, CSV/JSON/HTML/PDF.

## Features (per frame, analysis band 450-2000 Hz by default)
RMS (dBFS), spectral centroid and bandwidth, interpolated dominant frequency, tonal ratio (energy of the dominant peak +/-2 bins over a context band 100 Hz to min(1.5*band_hi, 0.45 fs)), zero-crossing rate. A peak on the band edge counts as non-tonal (spectral slope).

## Rules (1 s windows, 0.1 s step; defaults in `DetectorConfig`)
R1 level >= -60 dBFS; R2 frame tonal ratio >= 0.5; R3 tonal fraction >= 0.6; R4 robust f0 range (p95-p5) >= 150 Hz; R5 f0 std >= 40 Hz. Passing windows merge (gap <= 0.5 s), events are trimmed to their first/last tonal frame and must last >= 1 s. A steady horn passes R2/R3 but fails R4/R5. The heuristic score is the mean of three normalised terms; it is **not a probability**.

## Genuine test results (synthetic, `tests/test_roadsonic.py`)
Detected: clean siren, siren in low-pass noise at three volumes, two separate sirens, 8/22.05/44.1/48 kHz. Rejected: silence, white noise, traffic-like noise, steady horn chords/tones. Documented miss: a very weak siren (amplitude 0.01 vs noise 0.2). Documented limitation: out-of-phase stereo cancels in a mono mix. Timestamps within 0.6 s (0.8 s in noise). **No real recordings and no labelled dataset were evaluated; no accuracy is claimed.**

## Limitations
Possible false positives: horns with vibrato, alarms, music, squealing brakes, some speech. Possible misses: distant or masked sirens. Thresholds were chosen on synthetic signals, not tuned on real data.

## Future scope
A licensed, source-separated dataset; tuning on validation recordings; held-out evaluation (confusion matrix, precision, recall, F1, false-positive rate).

## Viva questions
1. *Why not just threshold the dominant frequency?* Horns and tones are tonal too; sirens additionally sweep or alternate in frequency (R4/R5).
2. *Why is the score not a probability?* It is uncalibrated and never compared with labelled outcomes.
3. *Why a context band in the tonal ratio?* Without it, low-pass road noise leaking into the band edge looked tonal (found and fixed by a test).
4. *Why can a siren be missed?* Low SNR leaves too little tonal energy to pass R2/R3.
5. *Is this machine learning?* No: fixed, readable rules.
