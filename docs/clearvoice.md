# ClearVoice - technical documentation

## Abstract
ClearVoice analyses audio recordings (waveform, calibrated spectrum, spectrogram), applies Butterworth filters and a voice-enhancement pipeline, and exports audio, numerical data and reports. All computation runs locally in Python (NumPy/SciPy); MATLAB is an optional, separately verified path.

## Problem and objectives
Make the effect of digital signal processing on a recording inspectable and reproducible: correct axes and units, honest metrics, no silent normalisation, resampling or clipping.

## Architecture
Browser (React) -> FastAPI (`/api/v1`) -> `processing/` (statistics, fft_analysis, spectrogram, filters, voice, comparison) and `services/` (store, reports). In-memory session store with TTL; no database.
Workflow: upload -> decode/validate -> metadata+statistics -> waveform/FFT/spectrogram -> filter or voice pipeline -> compare -> play -> export/report.

## Mathematics
- Sampling: t[n] = n/fs; Nyquist fs/2.
- DFT: X[k] = sum x[n] e^{-j2pi kn/N}; bin spacing df = fs/Nfft; single-sided amplitude = 2|X|/sum(w) (DC and Nyquist not doubled). Zero-padding interpolates the displayed spectrum; true resolution is set by the observed duration.
- STFT: X_m[k] = sum x[n+mH] w[n] e^{-j2pi kn/L}; dB reference = full-scale single-sided amplitude.
- Butterworth IIR in second-order sections; `sosfilt` (causal, phase delay, |H|) vs `sosfiltfilt` (forward-backward, noncausal, zero phase, |H|^2 so the cutoff is -6 dB).
- Spectral gating: alpha = 1 + 2*strength; G = max(1 - alpha*N/P, g_min)^(1/2), smoothed over frequency/time, applied on a Hann STFT with 75 % overlap, noisy phase kept.
- MSE = (1/N) sum (x-y)^2 measures signal change, not quality. SNR is reported only against a known clean reference (synthetic tests).

## Presets (exact parameters in `backend/app/processing/voice.py`)
natural_voice, speech_clarity, low_rumble, fan_noise, stationary_hiss, telephone_band, manual.

## Tests and genuine results
See `implementation_status.md`. Synthetic noise-reduction results (stationary white noise, known clean reference): SNR 14.2 -> 15.9 dB, 8.1 -> 14.0 dB, 2.1 -> 10.9 dB (strength 0.7, 20 dB floor). These do not establish quality for real speech.

## Limitations
A filter is not a denoiser. Spectral gating assumes roughly stationary noise and can create musical-noise artefacts or distort speech. No listening evaluation has been performed. Maximum 2 channels; limits 50 MB / 300 s by default.

## Future scope
Resampling with anti-aliasing, gain-matched A/B listening, non-stationary noise estimation, listening tests.

## References (classic works; verify details before citing)
- F. J. Harris, "On the use of windows for harmonic analysis with the discrete Fourier transform," Proc. IEEE 66(1), 1978.
- S. F. Boll, "Suppression of acoustic noise in speech using spectral subtraction," IEEE Trans. ASSP 27(2), 1979.
- A. V. Oppenheim and R. W. Schafer, Discrete-Time Signal Processing (Pearson).
- F. Gustafsson, "Determining the initial states in forward-backward filtering," IEEE Trans. Signal Process. 44(4), 1996.

## Viva questions
1. *Why is FFT bin spacing not the true resolution?* Bin spacing is fs/Nfft and shrinks with zero-padding; resolution is limited by the observed length N (about fs/N times the window main-lobe width).
2. *Why 2|X|/sum(w)?* A real sinusoid splits its amplitude between +f and -f; sum(w) is the window's coherent gain times N, so it keeps peak amplitudes correct.
3. *Why does zero-phase filtering change the cutoff attenuation?* The signal passes through |H| twice, so attenuation doubles: -3 dB becomes -6 dB.
4. *Can a high-pass remove speech-band noise?* No; it removes only frequencies below its cutoff.
5. *Does lower MSE mean better audio?* No; MSE measures how much the signal changed.
