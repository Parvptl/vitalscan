"""Typed request/response models for the VitalScan API.

Optional metrics use ``None`` rather than zero/placeholder values: a metric that
the notebook pipeline could not produce is reported as unavailable, never
fabricated.
"""

from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator, model_validator

from ..config import settings


# --------------------------------------------------------------------------
# Requests
# --------------------------------------------------------------------------
class FrameSignalPayload(BaseModel):
    """Per-frame optical signals extracted in the browser.

    Mirrors notebook cell 9: one grayscale value and one mean value per colour
    channel, per frame. Values are 0-255 intensities.
    """

    timestamps: list[float] = Field(..., description="Per-frame media timestamps in seconds.")
    gray: list[float] = Field(..., description="Per-frame mean grayscale intensity (0-255).")
    red: list[float] = Field(..., description="Per-frame mean red intensity (0-255).")
    green: list[float] = Field(..., description="Per-frame mean green intensity (0-255).")
    blue: list[float] = Field(..., description="Per-frame mean blue intensity (0-255).")

    @field_validator("timestamps", "gray", "red", "green", "blue")
    @classmethod
    def _bounded(cls, v: list[float]) -> list[float]:
        if len(v) > settings.max_samples:
            raise ValueError(f"Too many samples (max {settings.max_samples}).")
        return v

    @model_validator(mode="after")
    def _consistent(self):
        n = len(self.timestamps)
        if n < 2:
            raise ValueError("At least two frame samples are required.")
        for name in ("gray", "red", "green", "blue"):
            if len(getattr(self, name)) != n:
                raise ValueError(f"'{name}' must have the same length as 'timestamps'.")
        for name in ("gray", "red", "green", "blue"):
            for value in getattr(self, name):
                if not (-1.0 <= value <= 256.0):
                    raise ValueError(f"'{name}' values must be 0-255 intensities.")
        return self


class CaptureMeta(BaseModel):
    torch_enabled: Optional[bool] = None
    facing_mode: Optional[str] = None
    frame_width: Optional[int] = Field(default=None, ge=1, le=8192)
    frame_height: Optional[int] = Field(default=None, ge=1, le=8192)
    roi_width: Optional[int] = Field(default=None, ge=1, le=8192)
    roi_height: Optional[int] = Field(default=None, ge=1, le=8192)


class MeasurementRequest(BaseModel):
    signals: FrameSignalPayload
    meta: Optional[CaptureMeta] = None


# --------------------------------------------------------------------------
# Responses
# --------------------------------------------------------------------------
class CaptureInfo(BaseModel):
    fps: int
    duration_s: float
    samples: int
    effective_fps: Optional[float] = None
    jitter_ms: Optional[float] = None
    dropped_samples: Optional[int] = None
    torch_enabled: Optional[bool] = None
    facing_mode: Optional[str] = None
    frame_width: Optional[int] = None
    frame_height: Optional[int] = None
    roi_width: Optional[int] = None
    roi_height: Optional[int] = None
    video_width: Optional[int] = None
    video_height: Optional[int] = None
    total_frames: Optional[int] = None


class PulseRateResponse(BaseModel):
    """All four notebook pulse-rate outputs. ``fused`` is null when the
    notebook's fusion rule is inconclusive."""

    count_based: int
    ppi_based: int
    amdf_based: int
    fused: Optional[int]
    unit: Literal["bpm"] = "bpm"
    peaks_detected: int


class SignalQualityResponse(BaseModel):
    sqa_flag: int = Field(..., description="siv_SQA verdict: 0 = good, 1 = bad.")
    label: Literal["Good", "Bad"]
    method_spread_bpm: int
    good_segments: int
    total_segments: int


class RhythmResponse(BaseModel):
    ppi_method: Literal["Regular", "Irregular"]
    amdf_method: Literal["Regular", "Irregular"]
    segment_pulse_rates: list[int]
    segment_quality: list[int]


class SpO2Response(BaseModel):
    value: float
    unit: Literal["%"] = "%"
    experimental: Literal[True] = True
    ratio_of_ratios: float
    ac_red: float
    dc_red: float
    ac_blue: float
    dc_blue: float
    calibration: str


class PerfusionIndexResponse(BaseModel):
    value: float
    unit: Literal["%"] = "%"
    experimental: Literal[True] = True


class RespiratoryRateResponse(BaseModel):
    value: float
    unit: Literal["breaths/min"] = "breaths/min"
    experimental: Literal[True] = True


class WaveformResponse(BaseModel):
    rppg: list[float]
    raw: list[float]
    peak_indices: list[int]
    decimation: int
    fps: int


class AmdfResponse(BaseModel):
    curve: list[float]
    minima_indices: list[int]


class MeasurementResponse(BaseModel):
    status: Literal["success"] = "success"
    source: Literal["frame-signals", "video"]
    capture: CaptureInfo
    pulse_rate: PulseRateResponse
    signal_quality: SignalQualityResponse
    rhythm: RhythmResponse
    spo2: Optional[SpO2Response] = None
    perfusion_index: Optional[PerfusionIndexResponse] = None
    respiratory_rate: Optional[RespiratoryRateResponse] = None
    waveform: WaveformResponse
    amdf: AmdfResponse
    pulse_intervals_s: list[float]
    notes: list[str] = []


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    video_endpoint_available: bool


class ConfigResponse(BaseModel):
    measurement_seconds: int
    min_analysis_seconds: float
    max_samples: int
    metrics: list[str]


class ErrorResponse(BaseModel):
    status: Literal["error"] = "error"
    code: str
    message: str
