# RoadSonic audit (before this iteration) and what was done

Method: read `routes.py` (RoadSonic section), `siren_features.py`, `siren_detector.py`, `RoadSonic.tsx`, tests, and ran the baseline suite (110 passed).

| # | Finding (verified by reading/running) | Status |
|---|---|---|
| 1 | Detector config accepted as an unvalidated dict (`DetectorConfig(**req.config)`): no bounds, wrong types pass | **Fixed**: pydantic models with bounds (`schemas/roadsonic.py`), `GET /roadsonic/defaults` |
| 2 | Frame/hop length, band, thresholds not user-settable from the UI (3 knobs only) | **Fixed**: full settings panel, validation, reset, dirty flag |
| 3 | No FFT spectrum, no spectral flatness, no peak prominence | **Fixed** (tested on known signals) |
| 4 | Events had no explanation, no frequency trajectory, no score definition | **Fixed** |
| 5 | Event timestamps not clamped to [0, duration] | **Fixed** (+ test) |
| 6 | No maximum event duration | **Fixed** (optional; splitting without overlap, tested) |
| 7 | No preprocessing / original-vs-processed comparison; unclear which audio produced results | **Fixed**: filter + adaptive noise reduction; `detect_on`; comparison runs both versions with identical settings |
| 8 | Playback only of the whole file; no event clips with context | **Fixed**: `/event/{i}/audio?pre=&post=` |
| 9 | No evaluation | **Added**: event-level precision/recall/F1/false alarms/min from user labels |
| 10 | Spectrogram payload unbounded in frame count for long audio | **Fixed**: frames bounded (~4000), payload <= 600x200 cells |
| 11 | Trajectory description used a faulty turning-point tracker (found by a smoke test: sinusoidal siren reported as "falling sweep") | **Fixed** (+ tests on known shapes) |
| 12 | Split pieces of a long event could overlap by half a frame (found by a test) | **Fixed** |
| 13 | RoadSonic page was a 69-line stub (3 settings, no spectrum/features/timeline/compare/evaluation) | **Rewritten** (unbuilt here; see status) |
| 14 | ML classifier | **Not implemented, deliberately**: no licensed, source-separated dataset available |
