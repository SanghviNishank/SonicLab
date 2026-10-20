"""Synthetic signals with known ground truth."""
import numpy as np

def tone(f, fs=16000, dur=1.0, amp=1.0, phase=0.0):
    t = np.arange(int(fs * dur)) / fs
    return amp * np.sin(2 * np.pi * f * t + phase)

def siren(fs=16000, dur=4.0, f_lo=600, f_hi=1400, rate=0.5, amp=0.5):
    """Wail: sinusoidal frequency sweep between f_lo and f_hi, `rate` sweeps/s."""
    t = np.arange(int(fs * dur)) / fs
    fc, dev = (f_lo + f_hi) / 2, (f_hi - f_lo) / 2
    phase = 2 * np.pi * fc * t - dev / rate * np.cos(2 * np.pi * rate * t)
    return amp * np.sin(phase)

def noise(n, seed=0, amp=0.1):
    return amp * np.random.default_rng(seed).standard_normal(n)

def traffic_like(n, fs=16000, seed=1, amp=0.3):
    from scipy.signal import butter, sosfilt
    return sosfilt(butter(4, 400 / (fs / 2), output="sos"), noise(n, seed, 1.0)) * amp
