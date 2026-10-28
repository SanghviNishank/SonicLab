"""Frame-based voice-activity detection (VAD) and pitch tracking. Rule-based, no model, no training.

Per frame (48 ms Hann, 16 ms hop; longer frames give a cleaner pitch peak: measured speech 0.75-0.81 vs noise-only <=0.41 at 5 dB SNR, 32 ms gave 0.58-0.66) on the mono mix, low-passed at 1.5 kHz (zero-phase) for the decision:
  energy_db      : 10 log10 of mean-square (dB re full scale^2)
  periodicity    : max normalised autocorrelation at lags for 70-400 Hz (1 = perfectly periodic)
  f0_hz          : lag of that maximum, converted to Hz (valid only if periodicity is high)
A frame is 'voiced-speech-like' when  energy_db > floor_db + min_snr_db  AND  periodicity >= min_periodicity,
where floor_db is a low percentile of the file's frame energies. A hangover (default 250 ms) bridges unvoiced
consonants and short pauses; isolated shorter-than-min_speech_s blobs are dropped.
LIMITS: any periodic, loud sound (a sustained instrument, a hum) also satisfies these rules - the VAD finds
'speech-like' frames, it does NOT identify who is speaking and cannot tell speech from music reliably.
"""
from __future__ import annotations
import numpy as np
from scipy import signal
from scipy.ndimage import binary_closing, binary_opening, maximum_filter1d


def frame_signal(x: np.ndarray, L: int, H: int) -> np.ndarray:
    if x.size < L:
        x = np.pad(x, (0, L - x.size))
    # A strided read-only VIEW of the frames (no index matrix, no copy): callers process it in chunks.
    return np.lib.stride_tricks.sliding_window_view(x, L)[::H]


def pitch_features(x: np.ndarray, fs: float, frame_ms: float = 48.0, hop_ms: float = 16.0,
                   fmin: float = 70.0, fmax: float = 400.0) -> dict:
    L, H = int(round(frame_ms * fs / 1000)), int(round(hop_ms * fs / 1000))
    fr = frame_signal(np.asarray(x, dtype=np.float64), L, H)
    w = np.hanning(L)
    n_fft = 1 << int(np.ceil(np.log2(2 * L)))
    out_per, out_f0, out_db = [], [], []
    lo, hi = int(fs / fmax), min(int(fs / fmin), L - 1)
    chunk = max(1, 4_000_000 // n_fft)
    for s in range(0, fr.shape[0], chunk):
        seg = fr[s:s + chunk]
        seg = seg - seg.mean(axis=1, keepdims=True)                    # per-frame DC removal, chunk by chunk
        ms = np.mean(seg ** 2, axis=1)
        sp = np.abs(np.fft.rfft(seg * w, n=n_fft, axis=1)) ** 2
        r = np.fft.irfft(sp, axis=1)[:, : hi + 1]
        r0 = np.maximum(r[:, 0], 1e-30)
        rn = r / r0[:, None]
        k = lo + np.argmax(rn[:, lo:hi + 1], axis=1)
        out_per.append(rn[np.arange(rn.shape[0]), k]); out_f0.append(fs / k); out_db.append(10 * np.log10(ms + 1e-12))
    per, f0, db = np.concatenate(out_per), np.concatenate(out_f0), np.concatenate(out_db)
    t = (np.arange(per.size) * H + L / 2) / fs
    return {"time_s": t, "periodicity": per, "f0_hz": f0, "energy_db": db, "hop_s": H / fs, "frame_s": L / fs}


def detect_speech(x: np.ndarray, fs: float, min_snr_db: float = 10.0, min_periodicity: float = 0.5,
                  hangover_s: float = 0.25, min_speech_s: float = 0.15, floor_percentile: float = 10.0) -> dict:
    x = np.asarray(x, dtype=np.float64)
    if fs > 4000:      # voiced speech is periodic mostly below ~1.5 kHz; low-passing raises periodicity SNR against broadband noise
        x = signal.sosfiltfilt(signal.butter(4, 1500 / (fs / 2), output="sos"), x)
    f = pitch_features(x, fs)
    floor = float(np.percentile(f["energy_db"], floor_percentile))
    cand = (f["energy_db"] > floor + min_snr_db) & (f["periodicity"] >= min_periodicity)
    hop = f["hop_s"]
    n_hang = max(1, int(round(hangover_s / hop)))
    mask = binary_closing(maximum_filter1d(cand.astype(np.uint8), 1) > 0, structure=np.ones(2 * n_hang + 1, bool))
    n_min = max(1, int(round(min_speech_s / hop)))
    mask = binary_opening(mask, structure=np.ones(n_min, bool))
    d = np.diff(np.r_[0, mask.astype(int), 0]); starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
    segs = [{"start_s": float(f["time_s"][a] - f["frame_s"] / 2), "end_s": float(f["time_s"][b - 1] + f["frame_s"] / 2)}
            for a, b in zip(starts, ends)]
    return {"mask": mask, "time_s": f["time_s"], "hop_s": hop, "segments": segs, "floor_db": floor,
            "speech_fraction": float(mask.mean()), "f0_hz": f["f0_hz"], "periodicity": f["periodicity"], "energy_db": f["energy_db"],
            "params": {"min_snr_db": min_snr_db, "min_periodicity": min_periodicity, "hangover_s": hangover_s,
                       "min_speech_s": min_speech_s, "floor_percentile": floor_percentile},
            "note": "speech-LIKE frames (loud + periodic); does not identify the speaker and cannot separate speech from music"}


def speaker_f0_profile(ref: np.ndarray, fs: float, min_periodicity: float = 0.7) -> dict:
    """Pitch range of a reference recording (voiced frames only). A rough speaker-range indicator, NOT speaker verification."""
    f = pitch_features(ref, fs)
    v = (f["periodicity"] >= min_periodicity) & (f["energy_db"] > np.percentile(f["energy_db"], 30))
    if v.sum() < 20:
        raise ValueError("reference too short or too noisy: fewer than 20 clearly voiced frames")
    f0 = f["f0_hz"][v]
    return {"f0_p05": float(np.percentile(f0, 5)), "f0_median": float(np.median(f0)), "f0_p95": float(np.percentile(f0, 95)),
            "voiced_frames": int(v.sum())}
