"""Analyse a recording, process it with the ClearVoice voice pipeline, verify the exported WAV, write a report.

Usage (from the backend folder, venv active):
  python ../scripts/analyze_and_process.py --input Row_Four_at_Midnight.mp3 --preset lecture_speech \
      --output ClearVoice_filtered.wav --outdir ../docs/analysis [--compare old_output.wav] [--reference prof_voice.wav]

Everything reported is computed from the files; nothing is estimated by hand. No listening is performed.
"""
from __future__ import annotations
import argparse, json, sys, time
from pathlib import Path
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.processing import audio_io, statistics as st, voice as vc, vad as vadmod            # noqa: E402
from app.processing.fft_analysis import single_sided_spectrum, find_spectral_peaks            # noqa: E402

import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt                     # noqa: E402
from scipy import signal                                                                       # noqa: E402

BANDS = [(20, 60), (60, 120), (120, 250), (250, 500), (500, 1000), (1000, 2000), (2000, 4000), (4000, 8000), (8000, 16000)]


def load(path: Path) -> dict:
    return audio_io.decode_audio(path.read_bytes())


def band_db(x: np.ndarray, fs: float) -> dict:
    f, P = signal.welch(x.mean(axis=0), fs, nperseg=8192)
    tot = P.sum()
    return {f"{lo}-{hi}": float(P[(f >= lo) & (f < hi)].sum() / tot) for lo, hi in BANDS}


def describe(x: np.ndarray, fs: float) -> dict:
    s = st.audio_statistics(x, fs)
    m = x.mean(axis=0)
    sp = single_sided_spectrum(m[: min(m.size, 2 ** 20)], fs, "hann")
    return {"stats": s, "band_energy_fraction": band_db(x, fs),
            "peaks": find_spectral_peaks(sp["freqs_hz"], sp["amplitude"], 5),
            "over_full_scale_samples": int(np.count_nonzero(np.abs(x) > 1.0)), "freq_resolution_hz": sp["nominal_resolution_hz"]}


def make_figures(x, y, fs, outdir: Path, tag: str) -> list[str]:
    files = []
    mx, my = x.mean(axis=0), y.mean(axis=0)
    fig, ax = plt.subplots(3, 1, figsize=(11, 10))
    for sig_, lab in ((mx, "input"), (my, "processed")):
        fr = int(0.05 * fs); n = sig_.size // fr
        env = np.sqrt((sig_[: n * fr].reshape(n, fr) ** 2).mean(1))
        ax[0].plot(np.arange(n) * fr / fs, 20 * np.log10(env + 1e-9), lw=0.8, label=lab)
    ax[0].set_ylabel("50 ms RMS (dBFS)"); ax[0].set_xlabel("Time (s)"); ax[0].legend(); ax[0].grid(alpha=0.3); ax[0].set_title("Amplitude envelope (mid channel)")
    for sig_, lab in ((mx, "input"), (my, "processed")):
        f, P = signal.welch(sig_, fs, nperseg=8192); ax[1].semilogx(f[1:], 10 * np.log10(P[1:] + 1e-20), lw=0.8, label=lab)
    ax[1].set_xlabel("Frequency (Hz)"); ax[1].set_ylabel("PSD (dB re full-scale^2/Hz)"); ax[1].legend(); ax[1].grid(alpha=0.3, which="both"); ax[1].set_title("Welch spectrum")
    f, P = signal.welch(mx, fs, nperseg=8192); _, Q = signal.welch(my, fs, nperseg=8192)
    ax[2].semilogx(f[1:], 10 * np.log10((Q[1:] + 1e-20) / (P[1:] + 1e-20)), lw=0.8); ax[2].axhline(0, color="k", lw=0.5)
    ax[2].set_xlabel("Frequency (Hz)"); ax[2].set_ylabel("processed / input (dB)"); ax[2].grid(alpha=0.3, which="both"); ax[2].set_title("Spectral change")
    plt.tight_layout(); p = outdir / f"{tag}_waveform_spectrum.png"; plt.savefig(p, dpi=80); plt.close(fig); files.append(p.name)
    fig, ax = plt.subplots(3, 1, figsize=(11, 10), sharex=True)
    for a_, sig_, lab in ((ax[0], mx, "input"), (ax[1], my, "processed")):
        ff, tt, S = signal.spectrogram(sig_, fs, nperseg=2048, noverlap=1536)
        a_.pcolormesh(tt, ff, 10 * np.log10(S + 1e-12), vmin=-110, vmax=-30, shading="auto"); a_.set_ylim(0, 8000); a_.set_ylabel("Hz"); a_.set_title(f"Spectrogram - {lab} (dB re full-scale^2 per bin)")
    ff, tt, S1 = signal.spectrogram(mx, fs, nperseg=2048, noverlap=1536); _, _, S2 = signal.spectrogram(my, fs, nperseg=2048, noverlap=1536)
    d = 10 * np.log10((S2 + 1e-12) / (S1 + 1e-12)); im = ax[2].pcolormesh(tt, ff, d, vmin=-15, vmax=15, cmap="coolwarm", shading="auto"); ax[2].set_ylim(0, 8000)
    ax[2].set_ylabel("Hz"); ax[2].set_xlabel("Time (s)"); ax[2].set_title("Difference (processed - input, dB)"); fig.colorbar(im, ax=ax[2])
    plt.tight_layout(); p = outdir / f"{tag}_spectrograms.png"; plt.savefig(p, dpi=80); plt.close(fig); files.append(p.name)
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True); ap.add_argument("--output", default="ClearVoice_filtered.wav")
    ap.add_argument("--preset", default="lecture_speech"); ap.add_argument("--overrides", default="{}", help="JSON overrides for the pipeline")
    ap.add_argument("--outdir", default="analysis"); ap.add_argument("--compare", help="an existing processed file to analyse as well")
    ap.add_argument("--reference", help="optional reference recording of the target speaker (pitch-range indicator only)")
    ap.add_argument("--subtype", default="pcm16", choices=["pcm16", "float32"])
    a = ap.parse_args()
    out = Path(a.outdir); out.mkdir(parents=True, exist_ok=True)

    src = load(Path(a.input)); x, fs = src["samples"], src["sample_rate"]
    report = {"input": {"file": Path(a.input).name, "format": src["source_format"], "decoded_as": src["subtype"], "sample_rate_hz": fs,
                        "channels": int(x.shape[0]), "samples_per_channel": int(x.shape[1]), "duration_s": x.shape[1] / fs, **describe(x, fs)}}
    m = x.mean(axis=0)
    report["input"]["stereo"] = {"lr_correlation": float(np.corrcoef(x[0], x[-1])[0, 1]) if x.shape[0] > 1 else None}
    v = vadmod.detect_speech(m, fs)
    report["input"]["speech_like_frames"] = {"fraction": v["speech_fraction"], "segments": len(v["segments"]), "note": v["note"]}
    e = v["energy_db"]; report["input"]["frame_energy_db_percentiles_5_25_50_75_95"] = np.percentile(e, [5, 25, 50, 75, 95]).round(1).tolist()
    if a.reference:
        ref = load(Path(a.reference)); prof = vadmod.speaker_f0_profile(ref["samples"].mean(axis=0), ref["sample_rate"])
        f0 = v["f0_hz"][(v["periodicity"] >= 0.7)]
        inside = float(np.mean((f0 >= prof["f0_p05"]) & (f0 <= prof["f0_p95"]))) if f0.size else None
        report["reference_pitch_profile"] = {**prof, "fraction_of_periodic_input_frames_inside_reference_f0_range": inside,
                                              "caveat": "pitch-range overlap is NOT speaker verification"}

    t0 = time.time()
    res = vc.run_voice_pipeline(x, fs, a.preset, json.loads(a.overrides)); y = res["output"]
    report["processing"] = {"preset": a.preset, "seconds": time.time() - t0, "history": res["history"], "quality": res["quality"],
                            "warnings": res["warnings"], "engine": res["engine"]}
    report["output"] = describe(y, fs)

    data, info = audio_io.encode_wav(y, fs, a.subtype)
    Path(a.output).write_bytes(data)
    # ---- verify the file that was actually written
    back = audio_io.decode_audio(Path(a.output).read_bytes())
    yb = back["samples"]
    tol = 1.0 / 32768 if a.subtype == "pcm16" else 1e-6
    d = x - yb
    report["verification"] = {"file": str(a.output), "sample_rate_ok": back["sample_rate"] == fs, "shape_ok": yb.shape == x.shape,
                              "max_abs_error_vs_in_memory_result": float(np.max(np.abs(yb - y))), "tolerance": tol,
                              "matches_processed_samples": bool(np.max(np.abs(yb - y)) <= tol + 1e-12),
                              "differs_from_input_rms": float(np.sqrt(np.mean(d ** 2))), "is_copy_of_input": bool(np.array_equal(x, yb)),
                              "finite": bool(np.isfinite(yb).all()), "peak": float(np.max(np.abs(yb))), "clipped_samples_in_encoding": info["clipped_samples"],
                              "subtype": a.subtype}
    report["figures"] = make_figures(x, y, fs, out, "processed")
    if a.compare:
        old = load(Path(a.compare)); yo = old["samples"]
        n = min(yo.shape[1], x.shape[1]); report["existing_output"] = {"file": Path(a.compare).name, **describe(yo, old["sample_rate"]),
              "rms_difference_from_input": float(np.sqrt(np.mean((x[:, :n] - yo[:, :n]) ** 2))),
              "rms_difference_from_new_output": float(np.sqrt(np.mean((yb[:, :n] - yo[:, :n]) ** 2)))}
        report["figures"] += make_figures(x[:, :n], yo[:, :n], fs, out, "existing_output")
    (out / "analysis.json").write_text(json.dumps(report, indent=2, default=float))
    print(json.dumps({k: report[k] for k in ("verification",)}, indent=2, default=float))
    print("processing seconds: %.1f | quality ok: %s | issues: %s" % (report["processing"]["seconds"], res["quality"]["ok"], res["quality"]["issues"]))
    print("report: ", out / "analysis.json")


if __name__ == "__main__":
    main()
