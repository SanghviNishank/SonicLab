# Short demo explanation (for your professor)

**What ClearVoice does.** It decodes an audio file, shows its waveform, calibrated FFT spectrum and spectrogram, and applies digital signal processing: classical Butterworth filters (low/high/band-pass/notch) and a voice pipeline (DC removal, rumble high-pass, adaptive Wiener noise reduction, voice-activity-based attenuation, peak guard). Every stage is logged, the original is never modified, and the exported WAV is re-opened and checked against the processed samples.

**What we found with `Row_Four_at_Midnight`.** Measurement and spectrogram inspection show a music-like signal (steady ~82-104 Hz notes, percussive hits every ~1.3 s). The earlier output was correct but ineffective: spectral gating assumes steady noise and its automatic noise profile came from the song's fade-out. The 80 Hz high-pass also made 12 samples exceed full scale.

**What is and is not possible.** Filtering and Wiener noise reduction can reduce steady or slowly varying noise (hiss, fans, hum). They cannot pull one person's voice out of music or other talkers: that needs a speaker-extraction model and a reference recording of that voice. We report measured signal changes, not "improved quality", because there is no clean reference and no listening test was run.

**Key ideas to explain.** Sampling and Nyquist; FFT bin spacing vs true resolution; STFT time-frequency trade-off; Butterworth filters in second-order sections; causal vs zero-phase filtering; spectral subtraction/Wiener gain and musical noise; why MSE/RMS do not measure quality.
