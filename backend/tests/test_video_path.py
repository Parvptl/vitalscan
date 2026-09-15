"""Video-file path: the notebook's own entry point (ExtractVideo + cells 7/9).

A synthetic finger-video is rendered with a known pulse rate, run through
``extract_frame_signals`` and then the full pipeline. This checks the video
decode/downsample/averaging stage that the live browser client replaces.
"""

from __future__ import annotations

import os
import tempfile

import numpy as np
import pytest

from app.algorithms import video as video_mod
from app.services.pipeline import run_pipeline

cv2 = pytest.importorskip("cv2")

FPS = 30
BPM = 84
DISCARD = 2
DURATION = 30


@pytest.fixture(scope="module")
def synthetic_video_path():
    """Render a torch-lit fingertip: near-uniform red frame pulsing at BPM."""
    n = FPS * (DISCARD + DURATION + DISCARD)
    w, h = 160, 240
    path = os.path.join(tempfile.mkdtemp(), "finger.avi")
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"FFV1"), FPS, (w, h))
    if not writer.isOpened():  # pragma: no cover - codec availability varies
        pytest.skip("No lossless video writer available in this OpenCV build.")

    rng = np.random.default_rng(11)
    base = np.zeros((h, w, 3), dtype=np.float64)
    base[:, :, 0] = 34.0  # B
    base[:, :, 1] = 58.0  # G
    base[:, :, 2] = 198.0  # R
    texture = rng.normal(0, 1.5, (h, w, 1))

    for i in range(n):
        phase = 2 * np.pi * (BPM / 60.0) * (i / FPS)
        ac = np.sin(phase) + 0.3 * np.sin(2 * phase + 0.8)
        frame = base + texture
        frame[:, :, 2] += ac * 9.0
        frame[:, :, 1] += ac * 3.0
        frame[:, :, 0] += ac * 1.5
        writer.write(np.clip(frame, 0, 255).astype(np.uint8))
    writer.release()

    if not os.path.exists(path) or os.path.getsize(path) == 0:  # pragma: no cover
        pytest.skip("Video writing is unavailable in this environment.")
    yield path
    os.remove(path)


def test_extract_frame_signals_reports_notebook_style_metadata(synthetic_video_path):
    sig = video_mod.extract_frame_signals(
        synthetic_video_path, discard_sec=DISCARD, duration_sec=DURATION
    )
    assert sig.fps == FPS
    assert sig.used_frames == FPS * DURATION
    assert sig.width == 160 and sig.height == 240
    # d_gray is a SUM over the 0.1-downsampled frame: 16 x 24 = 384 pixels.
    assert sig.d_gray.mean() > 300 * 50
    assert 150 < sig.d_R.mean() < 255
    assert sig.d_B.mean() < sig.d_R.mean()


def test_video_pipeline_recovers_the_rendered_pulse_rate(synthetic_video_path):
    sig = video_mod.extract_frame_signals(
        synthetic_video_path, discard_sec=DISCARD, duration_sec=DURATION
    )
    result = run_pipeline(sig.d_gray, sig.d_R, sig.d_G, sig.d_B, sig.fps, source="video")
    assert result["pulse_rate"]["fused"] == pytest.approx(BPM, abs=5)
    assert result["signal_quality"]["label"] == "Good"


def test_video_too_short_is_rejected_like_the_notebook(synthetic_video_path):
    with pytest.raises(ValueError, match="too short"):
        video_mod.extract_frame_signals(synthetic_video_path, discard_sec=5, duration_sec=120)


def test_unreadable_file_raises_ioerror():
    with pytest.raises(IOError):
        video_mod.extract_frame_signals("does_not_exist.mp4")
