"""VitalScan API routes."""

from __future__ import annotations

import logging
import os
import tempfile

from fastapi import APIRouter, File, HTTPException, UploadFile

from ..algorithms import video as video_mod
from ..algorithms.resample import to_uniform_grid
from ..config import settings
from ..models.schemas import (
    ConfigResponse,
    HealthResponse,
    MeasurementRequest,
    MeasurementResponse,
)
from ..services.pipeline import PipelineError, run_pipeline

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api")

SUPPORTED_METRICS = [
    "pulse_rate",
    "signal_quality",
    "rhythm",
    "spo2",
    "perfusion_index",
    "respiratory_rate",
]


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        version=settings.version,
        video_endpoint_available=settings.enable_video_endpoint and video_mod.cv2_available(),
    )


@router.get("/config", response_model=ConfigResponse)
def config() -> ConfigResponse:
    return ConfigResponse(
        measurement_seconds=settings.measurement_seconds,
        min_analysis_seconds=settings.min_analysis_seconds,
        max_samples=settings.max_samples,
        metrics=SUPPORTED_METRICS,
    )


@router.post("/measurement/process", response_model=MeasurementResponse)
def process_measurement(payload: MeasurementRequest) -> MeasurementResponse:
    """Analyse per-frame optical signals captured by the browser.

    Nothing is persisted: the signal arrays live only for the duration of this
    request and are never written to disk or logged.
    """
    s = payload.signals
    try:
        uniform = to_uniform_grid(s.timestamps, s.gray, s.red, s.green, s.blue)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    meta = payload.meta.model_dump(exclude_none=True) if payload.meta else {}
    meta.update(
        {
            "effective_fps": round(uniform.effective_fps, 2),
            "jitter_ms": round(uniform.jitter_ms, 2),
            "dropped_samples": uniform.dropped_samples,
        }
    )

    try:
        result = run_pipeline(
            uniform.gray,
            uniform.red,
            uniform.green,
            uniform.blue,
            uniform.fps,
            source="frame-signals",
            capture_meta=meta,
        )
    except PipelineError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Measurement processing failed")
        raise HTTPException(
            status_code=500, detail="Measurement processing failed unexpectedly."
        ) from exc

    return MeasurementResponse(**result)


@router.post("/measurement/process-video", response_model=MeasurementResponse)
async def process_video(file: UploadFile = File(...)) -> MeasurementResponse:
    """Validation endpoint: run the notebook pipeline on a finger-video file.

    This reproduces the notebook's own entry point (``ExtractVideo`` + cells
    7/9) so the production port can be checked against the notebook's recorded
    results for the same clip. The live app does not use it.
    """
    if not settings.enable_video_endpoint:
        raise HTTPException(status_code=404, detail="Video endpoint is disabled.")
    if not video_mod.cv2_available():
        raise HTTPException(
            status_code=503, detail="OpenCV is not installed on the server; video analysis is unavailable."
        )

    suffix = os.path.splitext(file.filename or "")[1].lower()
    if suffix not in (".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"):
        raise HTTPException(status_code=415, detail="Unsupported video format.")

    tmp_path = None
    written = 0
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                written += len(chunk)
                if written > settings.max_video_bytes:
                    raise HTTPException(status_code=413, detail="Video file is too large.")
                tmp.write(chunk)

        signals = video_mod.extract_frame_signals(
            tmp_path,
            discard_sec=settings.video_discard_seconds,
            duration_sec=settings.video_duration_seconds,
        )
        result = run_pipeline(
            signals.d_gray,
            signals.d_R,
            signals.d_G,
            signals.d_B,
            signals.fps,
            source="video",
            capture_meta={
                "video_width": signals.width,
                "video_height": signals.height,
                "total_frames": signals.total_frames,
            },
        )
        return MeasurementResponse(**result)
    except HTTPException:
        raise
    except (PipelineError, ValueError, IOError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.exception("Video processing failed")
        raise HTTPException(status_code=500, detail="Video processing failed unexpectedly.") from exc
    finally:
        # Never keep uploaded footage around.
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.remove(tmp_path)
            except OSError:
                logger.warning("Could not remove temporary upload")
