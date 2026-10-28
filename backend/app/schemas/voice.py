"""Strict request schema for the voice pipeline overrides.

Before this schema, `overrides` was a free-form dict: unknown stage names (typos) were silently ignored and wrong value types
raised unhandled exceptions (HTTP 500). Now every stage is a model with bounds, unknown keys are rejected (HTTP 422), and only the
fields the caller actually sent are merged onto the preset (`model_dump(exclude_unset=True)`).
Bounds mirror the validation inside the DSP code, which stays authoritative.
"""
from __future__ import annotations
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

Hz = Annotated[float, Field(gt=0, lt=1_000_000)]
Order = Annotated[int, Field(ge=1, le=12, strict=True)]


class _Stage(BaseModel):
    model_config = ConfigDict(extra="forbid")


class DcRemoval(_Stage):
    enabled: bool = False


class Rumble(_Stage):
    enabled: bool = False
    cutoff_hz: Hz = 80.0
    order: Order = 4


class BandLimit(_Stage):
    enabled: bool = False
    highpass_hz: Hz | None = None
    lowpass_hz: Hz | None = None
    order: Order = 4


class NoiseReduction(_Stage):
    enabled: bool = False
    method: Literal["gate", "wiener"] = "gate"
    strength: float = Field(0.6, ge=0.0, le=1.0)
    max_reduction_db: float = Field(18.0, gt=0.0, le=60.0)
    frame_length: int = Field(2048, ge=256, le=8192)
    noise_segment_s: tuple[float, float] | None = None

    @field_validator("frame_length")
    @classmethod
    def _pow2(cls, v: int) -> int:
        if v & (v - 1):
            raise ValueError("frame_length must be a power of two")
        return v


class SpeechGate(_Stage):
    enabled: bool = False
    attenuation_db: float = Field(12.0, ge=0.0, le=30.0)


class Loudness(_Stage):
    enabled: bool = False
    target_peak_dbfs: float = Field(-1.0, ge=-60.0, le=0.0)


class PeakGuard(_Stage):
    enabled: bool = True
    ceiling_dbfs: float = Field(-0.5, ge=-60.0, le=0.0)


class VoiceOverrides(_Stage):
    dc_removal: DcRemoval | None = None
    rumble: Rumble | None = None
    band_limit: BandLimit | None = None
    noise_reduction: NoiseReduction | None = None
    speech_gate: SpeechGate | None = None
    loudness: Loudness | None = None
    peak_guard: PeakGuard | None = None
    method: Literal["causal", "zero_phase"] | None = None

    def to_pipeline_dict(self) -> dict:
        """Only what the caller sent, as plain dicts (stage -> fields), ready for voice.resolve_config()."""
        out: dict = {}
        for k in self.model_fields_set:
            v = getattr(self, k)
            if v is None:
                raise ValueError(f"{k} must not be null; omit it to keep the preset value")
            out[k] = v.model_dump(exclude_unset=True) if isinstance(v, BaseModel) else v
        return out
