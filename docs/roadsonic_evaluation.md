# RoadSonic evaluation on synthetic fixtures

**Scope.** 22 deterministic synthetic fixtures (fixed seeds, `backend/tests/fixtures_roadsonic.py`), ground truth known by construction. Sirens are frequency-modulated sinusoids, not recordings of real emergency vehicles. These numbers show the detector's behaviour on these signals only; they are **not** an estimate of real-world accuracy. Event match rule: IoU >= 0.3.

Environment: Python 3.12.3, NumPy 2.4.4, SciPy 1.17.1, x86_64. Regenerate with `python scripts/roadsonic_evaluate.py --markdown docs/roadsonic_evaluation.md`.

## Aggregate (pooled over all fixtures)

| sensitivity | TP | FP | FN | precision | recall | F1 | negative fixtures with a false alarm | mean abs start err (s) | mean abs end err (s) |
|---|---|---|---|---|---|---|---|---|---|
| low | 9 | 0 | 2 | 1.000 | 0.818 | 0.900 | 0/12 | 0.039 | 0.038 |
| medium | 11 | 0 | 0 | 1.000 | 1.000 | 1.000 | 0/12 | 0.039 | 0.038 |
| high | 11 | 1 | 0 | 0.917 | 1.000 | 0.957 | 1/12 | 0.040 | 0.040 |

## Per fixture (events as start-end seconds)

| fixture | category | truth | low | medium | high |
|---|---|---|---|---|---|
| wail_clean | siren-like | 3-7 | 2.96-7.04 | 2.96-7.04 | 2.96-7.04 |
| wail_traffic_noise | siren-like+noise | 3-7 | 2.96-7.04 | 2.96-7.04 | 2.96-7.04 |
| wail_engine_noise | siren-like+noise | 3-7 | 2.96-7.04 | 2.96-7.04 | 2.96-7.04 |
| wail_white_noise_0.2 | siren-like+noise | 3-7 | 2.98-7.02 | 2.96-7.02 | 2.96-7.04 |
| yelp_3_sweeps_per_s | siren-like | 3-7 | none | 2.98-7.04 | 2.96-7.04 |
| hi_lo_two_tone | siren-like | 3-7 | none | 2.96-7.04 | 2.96-7.04 |
| two_events_with_gap | siren-like | 1-3, 6-9 | 0.96-3.04, 5.95-9.04 | 0.96-3.04, 5.95-9.04 | 0.96-3.04, 5.95-9.04 |
| wail_volume_0.02 | siren-like (volume) | 3-7 | 2.96-7.04 | 2.96-7.04 | 2.96-7.04 |
| wail_volume_0.1 | siren-like (volume) | 3-7 | 2.96-7.04 | 2.96-7.04 | 2.96-7.04 |
| wail_volume_1.0 | siren-like (volume) | 3-7 | 2.96-7.04 | 2.96-7.04 | 2.96-7.04 |
| silence | silence | none | none | none | none |
| quiet_noise_-50dB | noise | none | none | none | none |
| traffic_noise_only | traffic | none | none | none | none |
| engine_road_noise_only | engine | none | none | none | none |
| white_noise_only | noise | none | none | none | none |
| horn_chord_440_550 | horn | none | none | none | none |
| horn_vibrato_900 | horn | none | none | none | none |
| slow_glide_tone | changing tone | none | none | none | 1.95-8.05 |
| pulsed_beeper_2.9k | alarm | none | none | none | none |
| reverse_beeper_1k | alarm | none | none | none | none |
| speech_like_plus_noise | speech | none | none | none | none |
| melody_stepped_tones | music-like | none | none | none | none |

## Robustness to white noise (wail amplitude 0.5, siren at 3-7 s; SNR measured during the siren)

| noise sigma | SNR (dB) | low | medium | high |
|---|---|---|---|---|
| 0.05 | 17.0 | TP1/FP0 | TP1/FP0 | TP1/FP0 |
| 0.1 | 11.0 | TP1/FP0 | TP1/FP0 | TP1/FP0 |
| 0.2 | 4.9 | TP1/FP0 | TP1/FP0 | TP1/FP0 |
| 0.3 | 1.4 | TP1/FP0 | TP1/FP0 | TP1/FP0 |
| 0.4 | -1.1 | TP1/FP0 | TP1/FP0 | TP1/FP0 |
| 0.5 | -3.0 | TP0/FP0 | TP1/FP0 | TP1/FP0 |
| 0.7 | -5.9 | TP0/FP0 | TP0/FP0 | TP1/FP0 |
| 1.0 | -9.0 | TP0/FP0 | TP0/FP0 | TP0/FP0 |

## Processing time (10 s clips, 16 kHz)

Median feature extraction 22 ms, median detection 7.9 ms per clip on this machine (see environment above).

## Known limitations

- Synthetic only; no real traffic, siren or speech recordings were evaluated.
- A slow 500-1500 Hz glide is flagged at high sensitivity (false alarm); weak or masked sirens are missed (see SNR sweep).
- Optimistic by construction: these fixtures resemble the synthetic signals used earlier to choose the thresholds (docs/roadsonic_benchmark_output.txt), so a perfect medium-sensitivity score is not evidence of generalisation.
- Scores are heuristic, not probabilities.
