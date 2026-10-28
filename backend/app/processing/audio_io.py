"""Multi-format audio decode + WAV encode with content validation.

Decode chain (first that succeeds):  SoundFile (libsndfile: WAV/FLAC/OGG/AIFF, MP3 on recent builds)
 -> scipy.io.wavfile (plain WAV only, if SoundFile is not installed)
 -> FFmpeg (MP3, M4A/AAC, anything else FFmpeg can decode), if installed.
Content is identified from magic bytes; the uploaded filename/MIME type is never trusted, and the
filename is never used as a path. Internal representation: float64, shape (channels, samples),
native sample rate (no resampling, no normalisation).
"""
from __future__ import annotations
import io, os, shutil, subprocess, tempfile
import numpy as np
from scipy.io import wavfile
from app.core.config import settings

try:  # optional
    import soundfile as sf
except Exception:  # pragma: no cover
    sf = None


class AudioError(ValueError):
    pass


def _mpeg_sync(d: bytes, i: int) -> bool:
    """True if d[i:i+3] looks like a VALID MPEG audio frame header (not just 11 sync bits)."""
    if i + 3 > len(d): return False
    b1, b2, b3 = d[i], d[i + 1], d[i + 2]
    return (b1 == 0xFF and (b2 & 0xE0) == 0xE0 and ((b2 >> 3) & 3) != 1     # version != reserved
            and ((b2 >> 1) & 3) != 0 and (b3 >> 4) != 0xF and ((b3 >> 2) & 3) != 3)   # layer, bitrate, samplerate valid


def sniff_format(d: bytes) -> str | None:
    if len(d) >= 12 and d[:4] in (b"RIFF", b"RF64") and d[8:12] == b"WAVE": return "wav"
    if d[:4] == b"fLaC": return "flac"
    if d[:4] == b"OggS": return "ogg"
    if len(d) >= 12 and d[:4] == b"FORM" and d[8:12] in (b"AIFF", b"AIFC"): return "aiff"
    if len(d) >= 8 and d[4:8] == b"ftyp": return "m4a"
    if d[:3] == b"ID3" or _mpeg_sync(d, 0): return "mp3"
    if len(d) > 2 and d[0] == 0xFF and (d[1] & 0xF6) == 0xF0: return "aac"           # ADTS, layer bits 00
    for offset in range(1, min(len(d) - 3, 2048)):                                   # leading junk before the first frame
        if d[offset:offset + 3] == b"ID3" or _mpeg_sync(d, offset):
            return "mp3"
    return None


SUPPORTED = ["wav", "flac", "ogg", "aiff", "mp3", "m4a", "aac"]


def ffmpeg_path() -> str | None:
    return os.getenv("CS_FFMPEG") or shutil.which("ffmpeg")


def capabilities() -> dict:
    return {"soundfile": sf is not None, "ffmpeg": ffmpeg_path() is not None,
            "formats_detected": SUPPORTED,
            "note": "WAV/FLAC/OGG/AIFF need SoundFile (WAV also works without it). MP3 and M4A/AAC need SoundFile "
                    "with MP3 support or FFmpeg on PATH. Formats not listed are rejected."}


def _validate(x: np.ndarray, fs: int) -> None:
    if fs <= 0 or x.ndim != 2 or x.shape[0] < 1:
        raise AudioError("invalid decoded audio layout")
    if x.shape[0] > settings.max_channels:
        raise AudioError(f"{x.shape[0]} channels found; at most {settings.max_channels} are supported")
    if x.shape[1] == 0:
        raise AudioError("audio is empty")
    if x.shape[1] > settings.max_samples or x.shape[1] / fs > settings.max_duration_s:
        raise AudioError(f"recording exceeds limits ({settings.max_duration_s:.0f} s / {settings.max_samples} samples)")
    if not np.all(np.isfinite(x)):
        raise AudioError("audio contains NaN or infinite samples")


_BLOCK_FRAMES = 1 << 20


def _via_soundfile(data: bytes):
    """Decode block by block straight into the final (channels, samples) float64 array.
    The previous version read a (samples, channels) array and then made a transposed COPY, holding two full-size arrays at once."""
    with sf.SoundFile(io.BytesIO(data)) as f:
        frames, ch, fs, fmt, sub = int(f.frames), int(f.channels), int(f.samplerate), f.format, f.subtype
        if frames > settings.max_samples:       # check BEFORE decoding
            raise AudioError("recording exceeds the sample limit")
        if ch > settings.max_channels:          # ... and before allocating anything proportional to the channel count
            raise AudioError(f"{ch} channels found; at most {settings.max_channels} are supported")
        out = np.empty((ch, max(frames, 0)), dtype=np.float64)
        pos = 0
        while True:
            blk = f.read(frames=_BLOCK_FRAMES, dtype="float64", always_2d=True)
            if blk.shape[0] == 0:
                break
            if pos + blk.shape[0] > out.shape[1]:           # lossy formats can declare an estimate: grow when the estimate was low
                out = np.concatenate([out, np.empty((ch, max(blk.shape[0], _BLOCK_FRAMES)))], axis=1)
            out[:, pos:pos + blk.shape[0]] = blk.T
            pos += blk.shape[0]
            if pos > settings.max_samples:
                raise AudioError("recording exceeds the sample limit")
    x = out if pos == out.shape[1] else out[:, :pos].copy()
    # Lossless uncompressed formats (WAV, AIFF) have exact frame counts declared in headers.
    # If fewer samples than declared are read, the file was truncated during transmission.
    # Note: For lossy / container formats (MP3, OGG), libsndfile estimates the frame count from file size,
    # which differs when ID3 tags, album art (GEOB), or variable bitrate headers are present.
    if fmt in ("WAV", "AIFF") and frames > 0 and pos < frames:
        raise AudioError("file is truncated: fewer samples than the header declares")
    return np.ascontiguousarray(x), fs, f"{fmt}/{sub}"


def _via_scipy_wav(data: bytes):
    fs, a = wavfile.read(io.BytesIO(data))
    if a.dtype == np.uint8: x = (a.astype(np.float64) - 128) / 128
    elif a.dtype == np.int16: x = a / 32768.0
    elif a.dtype == np.int32: x = a / 2147483648.0
    elif a.dtype in (np.float32, np.float64): x = a.astype(np.float64)
    else: raise AudioError(f"unsupported WAV sample type {a.dtype}")
    return np.atleast_2d(x.T if x.ndim == 2 else x).copy(), int(fs), f"WAV/{a.dtype}"


def _via_ffmpeg(data: bytes, kind: str):
    exe = ffmpeg_path()
    if not exe:
        raise AudioError(f"decoding {kind.upper()} requires FFmpeg, which was not found. Install it and add it to PATH "
                         "(Windows: `winget install Gyan.FFmpeg`), or convert the file to WAV/FLAC.")
    with tempfile.TemporaryDirectory(prefix="cs_") as td:
        src, dst = os.path.join(td, "in." + kind), os.path.join(td, "out.wav")   # server-chosen names
        with open(src, "wb") as f: f.write(data)
        cmd = [exe, "-v", "error", "-nostdin", "-i", src, "-t", str(settings.max_duration_s + 1),
               "-map", "0:a:0", "-c:a", "pcm_f32le", "-y", dst]
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=120)       # no shell, fixed argv
        except subprocess.TimeoutExpired:
            raise AudioError("decoding timed out")
        if r.returncode != 0 or not os.path.exists(dst):
            raise AudioError("FFmpeg could not decode this file (corrupt, truncated or unsupported codec)")
        with open(dst, "rb") as f: out = f.read()
    x, fs, _ = _via_scipy_wav(out)
    return x, fs, f"{kind.upper()} decoded by FFmpeg -> float32"


def _check_wav_truncation(data: bytes) -> None:
    """Walk the RIFF chunks; reject if the 'data' chunk declares more bytes than the file contains.
    (libsndfile silently shrinks a truncated file to what is present, so the decoder alone cannot tell.)"""
    if data[:4] != b"RIFF":
        return                                   # RF64 uses 64-bit sizes; not checked here
    pos = 12
    while pos + 8 <= len(data):
        cid, size = data[pos:pos + 4], int.from_bytes(data[pos + 4:pos + 8], "little")
        if cid == b"data":
            avail = len(data) - (pos + 8)
            if size not in (0, 0xFFFFFFFF) and size > avail:
                raise AudioError(f"WAV is truncated: header declares {size} bytes of audio but only {avail} are present")
            return
        pos += 8 + size + (size & 1)


def decode_audio(data: bytes) -> dict:
    if len(data) > settings.max_file_bytes:
        raise AudioError(f"file exceeds the {settings.max_file_bytes // 2**20} MB limit")
    kind = sniff_format(data[:4096]) if len(data) >= 4 else None
    if kind is None:
        raise AudioError("unrecognised audio content (not WAV, FLAC, OGG, AIFF, MP3, AAC or M4A); the file extension is ignored")
    if kind == "wav":
        _check_wav_truncation(data)
    warnings, x, fs, desc = [], None, None, None
    try:
        if sf is not None:
            try:
                x, fs, desc = _via_soundfile(data)
            except AudioError as ae:
                if "sample limit" in str(ae) or "exceeds" in str(ae):
                    raise
                # If SoundFile had a decoding/truncation error, fall back to FFmpeg if available
                if not ffmpeg_path():
                    raise
                x = None
            except Exception:
                if kind in ("mp3", "m4a", "aac", "ogg", "flac", "aiff"):
                    x = None
                elif kind == "wav":
                    if not ffmpeg_path():
                        raise
                    x = None
        if x is None and kind == "wav":
            x, fs, desc = _via_scipy_wav(data)
        if x is None:
            x, fs, desc = _via_ffmpeg(data, kind)
            warnings.append("Decoded with FFmpeg (lossy sources are decoded to float; no extra processing applied).")
    except AudioError:
        raise
    except Exception as e:
        raise AudioError(f"{kind.upper()} could not be decoded (corrupt, truncated or unsupported): {type(e).__name__}") from None
    _validate(x, fs)
    if kind in ("mp3", "m4a", "aac", "ogg"):
        warnings.append("Source is a lossy format; decoded samples differ slightly from the original recording.")
    return {"samples": np.ascontiguousarray(x), "sample_rate": int(fs), "source_format": kind,
            "subtype": desc, "format": kind.upper(), "warnings": warnings}


decode_wav = decode_audio   # backwards-compatible name used by earlier routes


def encode_wav(x: np.ndarray, fs: int, subtype: str = "float32") -> tuple[bytes, dict]:
    """Encode WAV. 'float32' (default): lossless for |x|>1, no clipping. 'pcm16': most compatible with
    players/editors; samples beyond +-1 are clipped and COUNTED (reported to the caller, never silent)."""
    a = np.atleast_2d(np.asarray(x, dtype=np.float64)).T          # (samples, channels)
    info = {"subtype": subtype, "clipped_samples": 0}
    if subtype == "float32":
        out = a.astype(np.float32)
    elif subtype == "pcm16":
        info["clipped_samples"] = int(np.count_nonzero(np.abs(a) > 32767 / 32768))
        out = np.round(np.clip(a, -1.0, 32767 / 32768) * 32768).astype(np.int16)
    else:
        raise AudioError("subtype must be 'float32' or 'pcm16'")
    buf = io.BytesIO()
    wavfile.write(buf, int(fs), out if out.shape[1] > 1 else out[:, 0])
    return buf.getvalue(), info
