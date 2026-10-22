"""Plain-Python (no pydantic) parameter table: defaults, bounds, units and help text for RoadSonic."""
from __future__ import annotations

# name -> (default, min, max, unit, group, label, help)
PARAMS: dict[str, tuple] = {
    "frame_ms": (64.0, 20.0, 200.0, "ms", "analysis", "Frame length", "Length of each analysis window. Longer = finer frequency detail but blurs fast sweeps; shorter = the reverse."),
    "hop_ms": (16.0, 5.0, 100.0, "ms", "analysis", "Hop length", "Step between frames (must not exceed the frame length). Smaller = smoother tracks and more computation."),
    "band_lo": (450.0, 100.0, 8000.0, "Hz", "analysis", "Band low edge", "Lowest frequency searched for the siren tone. Most emergency sirens sweep roughly within 400-2000 Hz, but not all."),
    "band_hi": (2000.0, 200.0, 12000.0, "Hz", "analysis", "Band high edge", "Highest frequency searched. Must be below half the sampling rate."),
    "min_rms_db": (-60.0, -120.0, 0.0, "dBFS", "detector", "Energy threshold", "Frames quieter than this are ignored. Raising it ignores weak (distant) sirens; lowering it admits more noise."),
    "min_tonal_ratio": (0.5, 0.0, 1.0, "ratio", "detector", "Spectral peak threshold", "Fraction of energy that must sit in one spectral peak for a frame to count as tonal. Higher = stricter."),
    "min_tonal_fraction": (0.6, 0.1, 1.0, "fraction", "detector", "Temporal continuity", "Fraction of frames in a 1 s window that must be tonal. Higher = needs a steadier tone."),
    "min_f0_range_hz": (150.0, 0.0, 4000.0, "Hz", "detector", "Frequency-sweep range", "Minimum robust range (5th-95th percentile) of the dominant frequency in a window. 0 would accept steady horns."),
    "min_f0_std_hz": (40.0, 0.0, 2000.0, "Hz", "detector", "Frequency variation", "Minimum standard deviation of the dominant frequency. Together with the range this separates sweeps from steady tones."),
    "window_s": (1.0, 0.3, 10.0, "s", "detector", "Decision window", "Length of the sliding window over which persistence and modulation are judged."),
    "window_step_s": (0.1, 0.02, 2.0, "s", "detector", "Window step", "How far the decision window moves each time. Controls event-boundary resolution."),
    "merge_gap_s": (0.5, 0.0, 10.0, "s", "detector", "Max gap between frames", "Passing windows closer than this are merged into one event (e.g. a siren briefly hidden by a truck)."),
    "min_event_s": (1.0, 0.2, 60.0, "s", "detector", "Min event duration", "Shorter candidates are discarded."),
    "max_event_s": (0.0, 0.0, 600.0, "s", "detector", "Max event duration", "0 = unlimited. If set, longer intervals are split into consecutive pieces of at most this length."),
    "min_peak_prominence_db": (0.0, 0.0, 60.0, "dB", "detector", "Peak prominence (optional)", "0 = off. Otherwise a tonal frame's peak must stand this many dB above the median band power."),
    "order": (4, 1, 8, "", "preprocessing", "Filter order", "Butterworth order. Higher = steeper but more ringing."),
    "nr_strength": (0.7, 0.0, 1.0, "", "preprocessing", "Noise-reduction strength", "Higher removes more steady noise but can also remove weak siren components."),
    "nr_max_db": (18.0, 1.0, 30.0, "dB", "preprocessing", "Max noise reduction", "Floor of the gain applied to noisy time-frequency cells."),
}
