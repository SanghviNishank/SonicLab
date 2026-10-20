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


def speech_like(fs=16000, dur=3.0, seed=0):
    """Synthetic voiced 'speech': glottal pulse train (f0 glides 110->140 Hz) through three formant
    resonators (700/1220/2600 Hz), with ~4 Hz syllabic amplitude modulation. Test signal only -
    it does NOT prove anything about natural-speech quality."""
    from scipy.signal import lfilter
    n = int(fs * dur)
    t = np.arange(n) / fs
    f0 = 110 + 30 * t / dur
    ph = np.cumsum(f0) / fs
    src = (np.diff(np.floor(ph), prepend=0) > 0).astype(float)           # impulse train
    src = lfilter([1.0], [1.0, -0.97], src)                               # spectral tilt
    y = np.zeros(n)
    for fc, bw in ((700, 90), (1220, 110), (2600, 160)):
        r = np.exp(-np.pi * bw / fs); th = 2 * np.pi * fc / fs
        y += lfilter([1 - r], [1, -2 * r * np.cos(th), r * r], src)
    env = 0.55 + 0.45 * np.sin(2 * np.pi * 4 * t) ** 2
    y *= env
    return 0.5 * y / np.max(np.abs(y))


def speech_like_realistic(fs=16000, dur=3.0, seed=0):
    """speech_like() with content below 70 Hz removed. The raw generator's spectral-tilt filter amplifies the impulse
    train's DC component ~33x, so its 'clean' reference holds a large sub-70 Hz component that real speech does not have;
    a rumble high-pass would then be (wrongly) scored as removing wanted signal."""
    from scipy.signal import butter, sosfiltfilt
    return sosfiltfilt(butter(4, 70 / (fs / 2), "highpass", output="sos"), speech_like(fs, dur, seed))
