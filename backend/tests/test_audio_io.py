import io, shutil, subprocess, tempfile, os
import numpy as np
import pytest
from scipy.io import wavfile
from app.processing import audio_io
from app.processing.audio_io import decode_audio, encode_wav, AudioError, sniff_format
from app.processing.fft_analysis import single_sided_spectrum, find_spectral_peaks
from synth import tone

FS = 16000

def peak_hz(x, fs):
    s = single_sided_spectrum(x, fs, "hann"); return find_spectral_peaks(s["freqs_hz"], s["amplitude"], 1)[0]["frequency_hz"]

def make(fmt_args, suffix, x=None, fs=FS):
    """Create a real encoded file with FFmpeg from a known tone (skip if FFmpeg is absent)."""
    if not shutil.which("ffmpeg"): pytest.skip("ffmpeg not installed")
    x = tone(1000, fs, 1.0, 0.5) if x is None else x
    with tempfile.TemporaryDirectory() as d:
        w, o = os.path.join(d, "a.wav"), os.path.join(d, "a" + suffix)
        wavfile.write(w, fs, x.astype(np.float32))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", w, *fmt_args, o], check=True)
        return open(o, "rb").read()

def test_wav_roundtrip_float32_exact_and_pcm16_quantised():
    x = np.vstack([tone(300, FS, 1.0, 0.5), tone(900, FS, 1.0, 0.25)])
    b, info = encode_wav(x, FS, "float32"); d = decode_audio(b)
    assert d["sample_rate"] == FS and d["samples"].shape == x.shape and np.max(abs(d["samples"] - x)) < 1e-7
    b, info = encode_wav(x, FS, "pcm16"); d = decode_audio(b)
    assert np.max(abs(d["samples"] - x)) < 1 / 32768 and info["clipped_samples"] == 0

def test_float32_preserves_out_of_range_and_pcm16_reports_clipping():
    x = np.array([[0.0, 1.5, -2.0, 0.5]])
    b, _ = encode_wav(x, FS, "float32"); assert np.allclose(decode_audio(b)["samples"], x)
    b, info = encode_wav(x, FS, "pcm16"); assert info["clipped_samples"] == 2     # counted, not silent
    assert np.max(abs(decode_audio(b)["samples"])) <= 1.0

def test_wav_sample_rates_preserved():
    for fs in (8000, 22050, 44100, 48000):
        assert decode_audio(encode_wav(tone(500, fs, 0.2), fs)[0])["sample_rate"] == fs

@pytest.mark.parametrize("case", [("flac", ["-c:a", "flac"], ".flac"), ("ogg", ["-c:a", "libvorbis"], ".ogg"),
                                  ("mp3", ["-c:a", "libmp3lame"], ".mp3"), ("m4a", ["-c:a", "aac"], ".m4a"),
                                  ("aiff", ["-c:a", "pcm_s16be"], ".aiff")])
def test_formats_decode_with_correct_rate_length_and_tone(case):
    kind, args, suf = case
    data = make(args, suf)
    assert sniff_format(data[:16]) == kind
    d = decode_audio(data)
    assert d["sample_rate"] == FS and d["samples"].shape[0] == 1 and d["source_format"] == kind
    n = d["samples"].shape[1]
    tol = FS * 0.15 if kind in ("mp3", "m4a", "ogg") else 0          # lossy codecs add padding
    assert abs(n - FS) <= tol, n
    assert abs(peak_hz(d["samples"][0][: FS // 2], FS) - 1000) < 5
    if kind in ("mp3", "m4a", "ogg"): assert any("lossy" in w for w in d["warnings"])

def test_stereo_flac_channels_preserved():
    x = np.vstack([tone(500, FS, 1.0), tone(2000, FS, 1.0)])
    if not shutil.which("ffmpeg"): pytest.skip("ffmpeg not installed")
    with tempfile.TemporaryDirectory() as d:
        w, o = os.path.join(d, "a.wav"), os.path.join(d, "a.flac")
        wavfile.write(w, FS, x.T.astype(np.float32))
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", w, "-c:a", "flac", o], check=True)
        r = decode_audio(open(o, "rb").read())
    assert r["samples"].shape[0] == 2
    assert abs(peak_hz(r["samples"][0], FS) - 500) < 2 and abs(peak_hz(r["samples"][1], FS) - 2000) < 2

def test_rejects_garbage_wrong_content_and_empty():
    for bad in (b"hello world, definitely not audio" * 3, b"", b"\x00" * 100, b"%PDF-1.4" + b"x" * 100):
        with pytest.raises(AudioError): decode_audio(bad)

def test_extension_is_irrelevant_content_decides():
    b, _ = encode_wav(tone(500, FS, 0.2), FS)       # WAV bytes: accepted no matter what the client called it
    assert decode_audio(b)["source_format"] == "wav"

def test_truncated_and_corrupt_files_rejected_or_flagged():
    b, _ = encode_wav(tone(500, FS, 1.0), FS)
    with pytest.raises(AudioError): decode_audio(b[:30])
    data = make(["-c:a", "flac"], ".flac")
    with pytest.raises(AudioError): decode_audio(data[:20] + b"\x00" * 50)

def test_size_limit_enforced():
    big = b"RIFF" + b"\x00" * (audio_io.settings.max_file_bytes + 10)
    with pytest.raises(AudioError): decode_audio(big)

def test_more_than_two_channels_rejected_clearly():
    x = np.random.default_rng(0).standard_normal((3, 800)) * 0.1
    buf = io.BytesIO(); wavfile.write(buf, FS, x.T.astype(np.float32))
    with pytest.raises(AudioError) as e: decode_audio(buf.getvalue())
    assert "channels" in str(e.value)

def test_capabilities_reports_truthfully():
    c = audio_io.capabilities(); assert c["ffmpeg"] == (shutil.which("ffmpeg") is not None)
