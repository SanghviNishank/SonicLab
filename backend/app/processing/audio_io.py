"""WAV decode/encode with content validation (never trusts extension/MIME)."""
from __future__ import annotations
import io
import numpy as np
import soundfile as sf
from app.core.config import settings


class AudioError(ValueError):
    pass


def decode_wav(data: bytes) -> dict:
    if len(data) > settings.max_file_bytes:
        raise AudioError(f"file exceeds the {settings.max_file_bytes // 2**20} MB limit")
    if len(data) < 44 or data[:4] not in (b"RIFF", b"RF64") or data[8:12] != b"WAVE":
        raise AudioError("not a RIFF/WAVE file (header check failed); only WAV is supported")
    try:
        info = sf.info(io.BytesIO(data))
    except Exception as e:  # soundfile raises RuntimeError on malformed files
        raise AudioError(f"WAV could not be parsed: {e}") from None
    if info.format != "WAV":
        raise AudioError("only WAV files are supported")
    if info.samplerate <= 0 or info.channels < 1 or info.channels > settings.max_channels:
        raise AudioError(f"unsupported sample rate/channels ({info.samplerate} Hz, {info.channels} ch)")
    if info.frames <= 0:
        raise AudioError("audio is empty")
    if info.frames > settings.max_samples or info.frames / info.samplerate > settings.max_duration_s:
        raise AudioError(f"recording exceeds limits ({settings.max_duration_s:.0f} s / {settings.max_samples} samples)")
    try:
        x, fs = sf.read(io.BytesIO(data), dtype="float64", always_2d=True)
    except Exception as e:
        raise AudioError(f"WAV data is truncated or corrupt: {e}") from None
    if x.shape[0] != info.frames:
        raise AudioError("WAV is truncated: fewer samples than the header declares")
    if not np.all(np.isfinite(x)):
        raise AudioError("audio contains NaN or infinite samples")
    return {"samples": np.ascontiguousarray(x.T), "sample_rate": int(fs),
            "subtype": info.subtype, "format": info.format}


def encode_wav(x: np.ndarray, fs: int) -> bytes:
    """32-bit float WAV: values outside [-1,1] are preserved (no clipping, no normalisation)."""
    buf = io.BytesIO()
    sf.write(buf, np.atleast_2d(x).T.astype(np.float32), int(fs), format="WAV", subtype="FLOAT")
    return buf.getvalue()
