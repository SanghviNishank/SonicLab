"""Speech-enhancement building blocks beyond a fixed noise profile.

spectral_wiener : adaptive noise-PSD tracking (smoothed minimum statistics, simplified) +
                  decision-directed square-root-Wiener gain (Ephraim & Malah style a-priori SNR).
The square-root form was chosen because plain Wiener gain lowered SNR on a synthetic speech test (speech distortion),
while the square-root form raised it (grid search over alpha/bias/over-estimation on synthetic signals only).
vad_attenuate   : gently attenuates (never mutes) intervals the VAD flags as non-speech.
peak_guard      : single static gain reduction when the peak would exceed a ceiling.
These handle stationary or SLOWLY VARYING noise. They cannot separate music or other talkers from speech.
"""
from __future__ import annotations
import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d, gaussian_filter1d


def track_noise_psd(P: np.ndarray, hop_s: float, window_s: float = 1.5, smooth: float = 0.85, bias: float = 1.3) -> np.ndarray:
    """P: (bins, frames) power. Smooth over time, then take the running minimum over `window_s`; `bias` compensates
    the known downward bias of minimum statistics
    (measured on synthetic white noise: bias=1 gives ~0.5x the true level, bias=1.3 about 0.7x; with speech pauses ~1.1x). Returns (bins, frames) noise PSD estimate."""
    Ps = np.empty_like(P)
    Ps[:, 0] = P[:, 0]
    for j in range(1, P.shape[1]):
        Ps[:, j] = smooth * Ps[:, j - 1] + (1 - smooth) * P[:, j]
    w = max(3, int(round(window_s / hop_s)))
    return bias * minimum_filter1d(Ps, size=w, axis=1, mode="nearest")


def spectral_wiener(x: np.ndarray, fs: float, strength: float = 0.7, max_reduction_db: float = 18.0,
                    frame_length: int = 2048, window_s: float = 1.5, alpha_dd: float = 0.98) -> dict:
    x = np.asarray(x, dtype=np.float64)
    if x.ndim != 1: raise ValueError("expected 1-D channel")
    if not 0.0 <= strength <= 1.0: raise ValueError("strength must be within [0, 1]")
    if not 0.0 < max_reduction_db <= 40.0: raise ValueError("max_reduction_db must be within (0, 40]")
    L = int(frame_length)
    if L < 256 or L > 8192 or L & (L - 1): raise ValueError("frame_length must be a power of two in [256, 8192]")
    if x.size < 4 * L: raise ValueError(f"recording too short for noise reduction (need >= {4 * L} samples)")
    hop = L // 4
    _, t, Z = signal.stft(x, fs=fs, window="hann", nperseg=L, noverlap=L - hop, boundary="zeros", padded=True)
    P = np.abs(Z) ** 2
    N = (1.0 + 0.5 * strength) * track_noise_psd(P, hop / fs, window_s)
    N = np.maximum(N, 1e-20)
    gmin = 10 ** (-max_reduction_db / 20)
    G = np.empty_like(P)
    gamma = P / N                                           # a-posteriori SNR
    xi_prev = np.maximum(gamma[:, 0] - 1, 0)
    g_prev = np.ones(P.shape[0])
    for j in range(P.shape[1]):
        xi = alpha_dd * (g_prev ** 2) * (gamma[:, max(j - 1, 0)] if j else gamma[:, 0]) + (1 - alpha_dd) * np.maximum(gamma[:, j] - 1, 0)
        xi = np.maximum(xi, 10 ** (-25 / 10))
        g = np.maximum(np.sqrt(xi / (1 + xi)), gmin)      # square-root Wiener gain: less speech distortion than plain Wiener (measured)
        G[:, j] = g; g_prev = g
    G = gaussian_filter1d(G, 0.5, axis=0)                   # very light smoothing across frequency (sigma 1.0 cost ~1 dB SNR in tests)
    G = np.maximum(G, gmin)
    _, y = signal.istft(Z * G, fs=fs, window="hann", nperseg=L, noverlap=L - hop, boundary=True)
    y = y[: x.size]
    if y.size < x.size: y = np.pad(y, (0, x.size - y.size))
    return {"y": y, "mean_gain_db": float(20 * np.log10(np.mean(G) + 1e-12)), "gain_floor_db": -max_reduction_db,
            "noise_window_s": window_s, "frame_length": L, "method": "adaptive noise tracking + decision-directed Wiener",
            "warnings": []}


def vad_attenuate(x: np.ndarray, fs: float, vad: dict, attenuation_db: float = 12.0, smooth_s: float = 0.08) -> dict:
    """x: (channels, samples). Gain 1 in speech-like frames, 10^(-att/20) elsewhere, smoothed so there are no clicks."""
    if not 0 <= attenuation_db <= 30: raise ValueError("attenuation_db must be within [0, 30]")
    t_f = vad["time_s"]; g_f = np.where(vad["mask"], 1.0, 10 ** (-attenuation_db / 20))
    t = np.arange(x.shape[-1]) / fs
    g = np.interp(t, t_f, g_f)
    k = max(1, int(round(smooth_s * fs)))
    g = uniform_filter1d(g, size=k, mode="nearest")
    return {"y": x * g[None, :], "mean_gain_db": float(20 * np.log10(np.mean(g))), "speech_fraction": vad["speech_fraction"]}


def peak_guard(x: np.ndarray, ceiling_dbfs: float = -0.5) -> tuple[np.ndarray, float]:
    """Returns (y, applied_gain_db). Reduces gain only if the peak exceeds the ceiling; otherwise y is x."""
    peak = float(np.max(np.abs(x))) if x.size else 0.0
    c = 10 ** (ceiling_dbfs / 20)
    if peak <= c: return x, 0.0
    g = c / peak
    return x * g, float(20 * np.log10(g))
