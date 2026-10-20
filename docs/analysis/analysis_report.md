# Analysis of `Row_Four_at_Midnight.mp3` and the existing `ClearVoice_filtered.wav`

All numbers below are computed by `scripts/analyze_and_process.py` (raw data: `analysis/analysis.json`). **No listening was performed** - I cannot play audio; statements about content come from measurements and spectrogram inspection only.

## 1. Files
| | Input | Existing output | New output |
|---|---|---|---|
| Format | MP3 (192 kbit/s), decoded to float | 32-bit float WAV | 16-bit PCM WAV |
| Sample rate | 44100 Hz | 44100 Hz | 44100 Hz |
| Channels | 2 | 2 | 2 |
| Samples / channel | 2634624 | 2634624 | 2634624 |
| Duration | 59.742 s | 59.742 s | 59.742 s |
| Samples above full scale (\|x\| > 1) | 0 | **12** | 0 |

## 2. Input statistics (population variance, full scale = 1)
| Ch | min | max | mean | RMS | variance | peak |
|---|---|---|---|---|---|---|
| 0 | -0.9837 | 0.9872 | 0.004357 | 0.1938 | 0.037546 | 0.9872 |
| 1 | -0.9810 | 0.9943 | 0.003924 | 0.1931 | 0.037257 | 0.9943 |

Left/right correlation 0.923 (mostly centre-panned). Frequency resolution of the long FFT: 0.0421 Hz. Strongest spectral peaks (estimates): 82.8 Hz, 82.2 Hz, 92.8 Hz, 82.6 Hz, 104.3 Hz.

## 3. What is in the recording (evidence, not assumption)
See `analysis/input_overview.png` and `analysis/input_zoom_0-3kHz.png`.
* **71 % of the energy lies below 120 Hz**, concentrated at about 82-104 Hz (steady, stepping notes).
* The zoomed spectrogram shows long **horizontal harmonic lines** (sustained tones) and **regularly spaced vertical broadband bars about every 1.3 s** (percussive hits), plus sliding curved harmonic bands from about 24 s and 40 s.
* The level fades from about 44 s to 59 s and the spectrum is cut at about 19 kHz (typical MP3 encoder low-pass).
* **Interpretation:** this looks like a **produced music track**, not a lecture recording. The curved bands could be a lead instrument or a voice; **nothing in the file lets me identify a professor's speech**, and I cannot confirm whether any speech is present.
* A rule-based "speech-like" detector flags **83 %** of frames as speech-like - which shows the detector cannot separate speech from sustained periodic music here (it only tests "loud and periodic").

## 4. Why the existing output still contained unwanted sound (root cause)
The existing `clearvoice_filtered.wav` is **exactly the `speech_clarity` preset** (maximum sample difference from re-running it: 3.8e-6). The filter was applied correctly to both channels, at the right sample rate, to the right array. The failures were:
1. **Wrong tool for the problem.** `speech_clarity` = DC removal + 80 Hz high-pass + *stationary spectral gating*. Music is not stationary noise, so gating has nothing valid to remove.
2. **The automatic noise profile was the song's fade-out.** The gate estimates noise from the quietest 10 % of frames; 90 % of those frames were in the 50-60 s fade-out, 31.5 dB below the median frame. Subtracting a noise floor that low changed 120-4000 Hz by less than 0.5 dB.
3. **Net effect:** only content below 80 Hz was materially changed (-22 dB in 20-60 Hz); the audible content was essentially unchanged (correlation with input 0.886 mostly due to the removed bass).
4. **Output overshoot:** the high-pass filter's ringing pushed the peak to 1.016 (**12 samples above full scale**). Stored as float it survives, but a 16-bit export or some players would clip. (Fixed: a reported `peak_guard` stage.)
5. **Misleading UI:** the UI reported success; the only warnings were generic. (Fixed: stage-by-stage history, limits stated beside the controls.)

*(Figures in items 2-3 - noise-frame locations, 31.5 dB gap, 0.886 correlation, band changes - came from a one-off diagnostic run during this investigation on the same files; the rest is in `analysis.json`.)*

Not the cause (checked): wrong sample rate, one channel only, filter applied twice, stale download, silent output.

## 5. Band energy (share of total energy, mid channel)
| Band | Input | Existing output | New output |
|---|---|---|---|
| 20-60 Hz | 8.7 % | 0.1 % | 0.1 % |
| 60-120 Hz | 62.3 % | 45.3 % | 37.5 % |
| 120-250 Hz | 12.9 % | 23.9 % | 27.9 % |
| 250-500 Hz | 10.4 % | 20.1 % | 21.7 % |
| 500-1000 Hz | 3.5 % | 6.7 % | 7.7 % |
| 1000-2000 Hz | 1.2 % | 2.3 % | 2.8 % |
| 2000-4000 Hz | 0.7 % | 1.2 % | 1.6 % |
| 4000-8000 Hz | 0.2 % | 0.4 % | 0.5 % |
| 8000-16000 Hz | 0.0 % | 0.0 % | 0.0 % |

## 6. New processing (`lecture_speech` preset, run through the same code as the app)
| Stage | Peak after | RMS after |
|---|---|---|
| dc_removal | 0.990 | 0.1934 |
| rumble_highpass | 1.017 | 0.1418 |
| noise_reduction | 0.973 | 0.1233 |
| speech_gate | 0.973 | 0.1212 |
| peak_guard | 0.944 | 0.1176 |

* Noise reduction: adaptive minimum-statistics tracking + square-root Wiener gain, strength 0.7, max 18.0 dB, mean gain -6.2 dB.
* Speech gate: attenuates non-speech intervals by 10.0 dB; **82 % of the file was classed speech-like**, so it changed little.
* Peak guard: -0.26 dB (peak would have exceeded -0.5 dBFS).
* Processing time 2.9 s. Quality checks: passed; peak 0.944; RMS change -4.3 dB; clipped samples 0.

## 7. Verification of the exported WAV
* Re-opened `ClearVoice_filtered.wav`: sample rate preserved = True, shape preserved = True, finite = True.
* Max difference to the in-memory processed samples: 1.53e-05 (16-bit quantisation limit 3.05e-05) -> **matches the processed signal: True**.
* RMS difference from the input: 0.1145; **identical to input: False**. Peak 0.944; samples clipped by encoding: 0.

## 8. What this does and does not show
* **Measured:** the file was processed, is playable, is not clipped, and has a lower broadband noise floor and less sub-100 Hz energy.
* **Not shown:** that any professor's voice is clearer or isolated. There is no clean reference, so **no SNR/PESQ/STOI is reported**. Lower RMS does not prove noise removal.
* **Music, other talkers and overlapping sounds cannot be separated** by these methods. Doing that for a *specific* person needs a speaker-extraction model plus a reference sample of that voice; none is available offline here and none was added.
* To proceed honestly I need: (a) the actual lecture recording (this file looks like music), and (b) 10-20 s of the professor speaking alone. With (b), `--reference` reports whether the input's pitch range overlaps the professor's - an indicator, not speaker verification.
