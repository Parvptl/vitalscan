"""Finger-video frame extraction.

Ports notebook cells 6, 7 and 9 of
``reference/Finger_Pulse_rPPG_Analysis_New.ipynb``.

This path exists so the production pipeline can be validated against the exact
video the notebook used. The live web client does not upload video: it derives
the same per-frame signals in the browser (see ``frontend/src/workers``) and
posts the numeric arrays instead.

OpenCV is imported lazily so the API still starts (and the signal-array
endpoint still works) in environments where ``cv2`` is unavailable.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

__all__ = ["FrameSignals", "cv2_available", "extract_frame_signals", "RESIZE_FACTOR"]

RESIZE_FACTOR = 0.1  # notebook cell 4


def cv2_available() -> bool:
    try:
        import cv2  # noqa: F401
    except Exception:
        return False
    return True


@dataclass
class FrameSignals:
    """Per-frame signals extracted from a finger video (notebook cell 9)."""

    d_gray: np.ndarray  # summed grayscale intensity per frame
    d_R: np.ndarray
    d_G: np.ndarray
    d_B: np.ndarray
    fps: int
    width: int
    height: int
    total_frames: int
    used_frames: int


def extract_frame_signals(
    path: str,
    discard_sec: int = 5,
    duration_sec: int = 60,
    resize_factor: float = RESIZE_FACTOR,
) -> FrameSignals:
    """Notebook cells 6 + 7 + 9, streamed frame-by-frame.

    The notebook buffers every decoded frame in a list before averaging. Here
    the per-frame reduction happens inline so memory stays flat regardless of
    clip length; the arithmetic on each retained frame is identical.
    """
    import cv2

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise IOError(f"Could not open video file: {path}")

    fps_raw = cap.get(cv2.CAP_PROP_FPS)
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    if not fps_raw or fps_raw != fps_raw or fps_raw <= 0:
        cap.release()
        raise ValueError("Could not determine the video frame rate.")
    fps = int(round(fps_raw))

    start = discard_sec * fps  # C1
    n_needed = duration_sec * fps

    gray_vals: list[float] = []
    r_vals: list[float] = []
    g_vals: list[float] = []
    b_vals: list[float] = []

    index = 0
    total = 0
    while True:
        ret, frame = cap.read()  # frame is BGR (OpenCV convention)
        if not ret:
            break
        total += 1
        if index < start:
            index += 1
            continue
        if len(gray_vals) >= n_needed:
            index += 1
            continue

        small = cv2.resize(
            frame, None, fx=resize_factor, fy=resize_factor, interpolation=cv2.INTER_AREA
        )
        b_ch = small[:, :, 0].astype(np.float64)
        g_ch = small[:, :, 1].astype(np.float64)
        r_ch = small[:, :, 2].astype(np.float64)
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY).astype(np.float64)

        gray_vals.append(float(np.sum(gray)))  # 'Averaging Entire Image for Intensity'
        r_vals.append(float(np.mean(r_ch)))
        g_vals.append(float(np.mean(g_ch)))
        b_vals.append(float(np.mean(b_ch)))
        index += 1

    cap.release()

    # Notebook cell 7 guard: the clip must contain discard + duration + discard.
    if start + n_needed > total:
        raise ValueError(
            f"Video too short: need {discard_sec * 2 + duration_sec}s of footage, "
            f"have {total / fps:.1f}s. Reduce duration_sec/discard_sec or use a longer video."
        )

    return FrameSignals(
        d_gray=np.asarray(gray_vals),
        d_R=np.asarray(r_vals),
        d_G=np.asarray(g_vals),
        d_B=np.asarray(b_vals),
        fps=fps,
        width=width,
        height=height,
        total_frames=total,
        used_frames=len(gray_vals),
    )
