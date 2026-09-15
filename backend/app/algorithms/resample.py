"""Uniform resampling of browser-captured frame signals.

DOCUMENTED ADAPTATION
---------------------
The notebook operates on a video file with a single, constant frame rate
(``fps = round(cap.get(CAP_PROP_FPS))``) and treats sample ``i`` as occurring at
``i / fps``. A browser camera stream does not guarantee a constant interval:
frames can be dropped or jittered by the device, the compositor or thermal
throttling.

To hand the notebook pipeline exactly the input shape it expects, the client
sends each sample together with its media timestamp, and this module maps the
irregular series onto a uniform grid at the effective frame rate using linear
interpolation. When the capture is already uniform this is a no-op. The
algorithm itself is untouched - only the time base is regularised.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

__all__ = ["UniformSignals", "to_uniform_grid"]


@dataclass
class UniformSignals:
    gray: np.ndarray
    red: np.ndarray
    green: np.ndarray
    blue: np.ndarray
    fps: int
    duration_s: float
    effective_fps: float
    dropped_samples: int
    jitter_ms: float


def to_uniform_grid(
    timestamps_s,
    gray,
    red,
    green,
    blue,
) -> UniformSignals:
    """Resample irregularly-timed frame signals onto a uniform grid.

    ``timestamps_s`` are seconds (any origin). Duplicate / non-monotonic
    timestamps are dropped, which can happen when a browser reports the same
    media time twice.
    """
    t = np.asarray(timestamps_s, dtype=float)
    channels = [np.asarray(c, dtype=float) for c in (gray, red, green, blue)]

    if t.ndim != 1 or len(t) < 2:
        raise ValueError("At least two frame samples are required.")
    if any(len(c) != len(t) for c in channels):
        raise ValueError("Timestamp and channel arrays must have the same length.")
    if not np.all(np.isfinite(t)) or not all(np.all(np.isfinite(c)) for c in channels):
        raise ValueError("Frame samples contain non-finite values.")

    order = np.argsort(t, kind="stable")
    t = t[order]
    channels = [c[order] for c in channels]

    keep = np.concatenate(([True], np.diff(t) > 1e-9))
    dropped = int(len(t) - np.count_nonzero(keep))
    t = t[keep]
    channels = [c[keep] for c in channels]

    if len(t) < 2:
        raise ValueError("At least two distinctly-timed frame samples are required.")

    t = t - t[0]
    duration = float(t[-1])
    if duration <= 0:
        raise ValueError("Capture duration must be positive.")

    intervals = np.diff(t)
    effective_fps = float((len(t) - 1) / duration)
    fps = int(round(effective_fps))
    if fps < 5:
        raise ValueError(
            f"Effective capture rate {effective_fps:.1f} fps is too low for pulse analysis."
        )

    n = int(np.floor(duration * fps)) + 1
    grid = np.arange(n) / fps
    resampled = [np.interp(grid, t, c) for c in channels]

    return UniformSignals(
        gray=resampled[0],
        red=resampled[1],
        green=resampled[2],
        blue=resampled[3],
        fps=fps,
        duration_s=float(grid[-1]),
        effective_fps=effective_fps,
        dropped_samples=dropped,
        jitter_ms=float(np.std(intervals) * 1000.0),
    )
