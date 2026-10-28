"""Memory-lean STFT/ISTFT with exactly scipy.signal.stft / istft semantics (Hann, boundary='zeros', padded=True, 'spectrum' scaling).

Why: scipy materialises the whole windowed-frame matrix AND the FFT output at once in stft(), and istft() additionally copies the
complex input and builds a full real frame matrix; for a 277 s / 44.1 kHz channel with 2048-sample frames that is ~1.2 GB of
temporaries on top of the 0.4 GB spectrogram. Here frames are transformed in chunks, so only the spectrogram itself stays large.
The arithmetic (window, scaling, FFT routine, overlap-add, normalisation) follows scipy line by line; tests compare against scipy.
"""
from __future__ import annotations
import numpy as np
from scipy import fft as sp_fft
from scipy.signal import get_window

_CHUNK_FRAMES = 1024


def stft(x: np.ndarray, fs: float, nperseg: int, hop: int) -> tuple[np.ndarray, np.ndarray]:
    """Returns (times_s, Z) with Z shaped (nperseg//2+1, frames), complex128; same as
    scipy.signal.stft(x, fs, 'hann', nperseg, nperseg-hop, boundary='zeros', padded=True)[1:]."""
    x = np.asarray(x, dtype=np.float64)
    win = get_window("hann", nperseg)
    scale = 1.0 / win.sum()
    xp = np.concatenate([np.zeros(nperseg // 2), x, np.zeros(nperseg // 2)])
    nadd = (-(xp.size - nperseg) % hop) % nperseg
    if nadd:
        xp = np.concatenate([xp, np.zeros(nadd)])
    n_frames = (xp.size - nperseg) // hop + 1
    frames = np.lib.stride_tricks.sliding_window_view(xp, nperseg)[::hop]            # a view, no copy
    Z = np.empty((nperseg // 2 + 1, n_frames), dtype=np.complex128)
    for s in range(0, n_frames, _CHUNK_FRAMES):
        e = min(n_frames, s + _CHUNK_FRAMES)
        Z[:, s:e] = (sp_fft.rfft(win * frames[s:e], axis=-1) * scale).T
    return np.arange(n_frames) * hop / float(fs), Z


def istft(Z: np.ndarray, nperseg: int, hop: int) -> np.ndarray:
    """Inverse of stft() above; same as scipy.signal.istft(Z, fs, 'hann', nperseg, nperseg-hop, boundary=True)[1].
    Does not modify or copy Z."""
    win = get_window("hann", nperseg)
    n_frames = Z.shape[1]
    out_len = nperseg + (n_frames - 1) * hop
    x = np.zeros(out_len)
    norm = np.zeros(out_len)
    w2 = win ** 2
    wsum = win.sum()
    for s in range(0, n_frames, _CHUNK_FRAMES):
        e = min(n_frames, s + _CHUNK_FRAMES)
        xs = sp_fft.irfft(Z[:, s:e], axis=0, n=nperseg)[:nperseg, :]
        xs *= wsum
        for k in range(e - s):
            i = (s + k) * hop
            x[i:i + nperseg] += xs[:, k] * win
            norm[i:i + nperseg] += w2
    x = x[nperseg // 2: -(nperseg // 2)]
    norm = norm[nperseg // 2: -(nperseg // 2)]
    x /= np.where(norm > 1e-10, norm, 1.0)
    return x
