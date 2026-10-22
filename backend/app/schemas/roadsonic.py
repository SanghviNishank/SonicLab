"""RoadSonic request schemas. roadsonic_params.PARAMS is the single source of truth for defaults, bounds and help text:
the API validates with it and GET /roadsonic/defaults sends it to the UI (tooltips, sliders, reset-to-default)."""
from __future__ import annotations
from pydantic import BaseModel, Field, model_validator

from .roadsonic_params import PARAMS


def F(name: str, **kw):
    d, lo, hi, *_ = PARAMS[name]
    return Field(d, ge=lo, le=hi, **kw)


class FeatureCfg(BaseModel):
    frame_ms: float = F("frame_ms")
    hop_ms: float = F("hop_ms")
    band_lo: float = F("band_lo")
    band_hi: float = F("band_hi")

    @model_validator(mode="after")
    def _check(self):
        if self.hop_ms > self.frame_ms: raise ValueError("hop_ms must not exceed frame_ms")
        if self.band_lo >= self.band_hi: raise ValueError("band_lo must be below band_hi")
        return self


class DetectorCfg(BaseModel):
    window_s: float = F("window_s")
    window_step_s: float = F("window_step_s")
    min_rms_db: float = F("min_rms_db")
    min_tonal_ratio: float = F("min_tonal_ratio")
    min_tonal_fraction: float = F("min_tonal_fraction")
    min_f0_range_hz: float = F("min_f0_range_hz")
    min_f0_std_hz: float = F("min_f0_std_hz")
    merge_gap_s: float = F("merge_gap_s")
    min_event_s: float = F("min_event_s")
    max_event_s: float = F("max_event_s")
    min_peak_prominence_db: float = F("min_peak_prominence_db")

    @model_validator(mode="after")
    def _check(self):
        if self.window_step_s > self.window_s: raise ValueError("window_step_s must not exceed window_s")
        if self.max_event_s and self.max_event_s < self.min_event_s: raise ValueError("max_event_s must be >= min_event_s (or 0)")
        return self


class FilterCfg(BaseModel):
    type: str = Field("none", pattern="^(none|highpass|lowpass|bandpass)$")
    cutoff_hz: list[float] = Field(default_factory=list, max_length=2)
    order: int = F("order")
    method: str = Field("zero_phase", pattern="^(zero_phase|causal)$")


class NoiseCfg(BaseModel):
    enabled: bool = False
    strength: float = F("nr_strength")
    max_reduction_db: float = F("nr_max_db")


class PreprocessCfg(BaseModel):
    channel_mode: str = Field("mix", pattern="^(mix|0|1)$")
    remove_dc: bool = True
    filter: FilterCfg = FilterCfg()
    noise_reduction: NoiseCfg = NoiseCfg()

    @property
    def active(self) -> bool:
        return self.filter.type != "none" or self.noise_reduction.enabled


class DetectReq(BaseModel):
    sensitivity: str | None = Field(None, pattern="^(low|medium|high)$")
    features: FeatureCfg = FeatureCfg()
    detector: DetectorCfg = DetectorCfg()
    preprocessing: PreprocessCfg = PreprocessCfg()
    detect_on: str = Field("auto", pattern="^(auto|original|processed)$")
    compare: bool = False


class TruthInterval(BaseModel):
    start_s: float = Field(ge=0)
    end_s: float = Field(gt=0)


class EvaluateReq(BaseModel):
    truth: list[TruthInterval] = Field(max_length=500)
    min_iou: float = Field(0.3, gt=0, le=1)
