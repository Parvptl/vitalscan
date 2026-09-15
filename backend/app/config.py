"""Application configuration, sourced from environment variables."""

from __future__ import annotations

import os
from dataclasses import dataclass, field


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except (TypeError, ValueError):
        return default


def _env_list(name: str, default: list[str]) -> list[str]:
    raw = os.getenv(name)
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


@dataclass(frozen=True)
class Settings:
    app_name: str = "VitalScan API"
    version: str = "1.0.0"

    # CORS: comma-separated origins. "*" is allowed for local development only.
    cors_origins: list[str] = field(
        default_factory=lambda: _env_list(
            "VITALSCAN_CORS_ORIGINS",
            ["http://localhost:5173", "http://127.0.0.1:5173"],
        )
    )

    # Measurement duration presented to the client (seconds).
    measurement_seconds: int = field(default_factory=lambda: _env_int("VITALSCAN_MEASUREMENT_SECONDS", 30))
    # Shortest signal the pipeline will attempt to analyse.
    min_analysis_seconds: float = field(
        default_factory=lambda: _env_float("VITALSCAN_MIN_ANALYSIS_SECONDS", 20.0)
    )
    # Hard cap on posted frame samples (30 s at 120 fps leaves plenty of headroom).
    max_samples: int = field(default_factory=lambda: _env_int("VITALSCAN_MAX_SAMPLES", 20000))
    # Upload limit for the reference-video validation endpoint (bytes).
    max_video_bytes: int = field(
        default_factory=lambda: _env_int("VITALSCAN_MAX_VIDEO_BYTES", 80 * 1024 * 1024)
    )
    # The reference-video endpoint is a developer/validation tool, off by default.
    enable_video_endpoint: bool = field(
        default_factory=lambda: os.getenv("VITALSCAN_ENABLE_VIDEO_ENDPOINT", "true").lower()
        in ("1", "true", "yes")
    )

    # Notebook defaults for the video-file path (cell 4).
    video_discard_seconds: int = field(default_factory=lambda: _env_int("VITALSCAN_VIDEO_DISCARD_SECONDS", 5))
    video_duration_seconds: int = field(
        default_factory=lambda: _env_int("VITALSCAN_VIDEO_DURATION_SECONDS", 60)
    )


settings = Settings()
