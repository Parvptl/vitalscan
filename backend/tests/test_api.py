"""API contract tests."""

from __future__ import annotations

import numpy as np
import pytest
from fastapi.testclient import TestClient

from app.main import app
from conftest import synthetic_finger_signals

client = TestClient(app)


def payload_from(s, meta=None):
    body = {
        "signals": {
            "timestamps": s["t"].tolist(),
            "gray": s["d_gray"].tolist(),
            "red": s["d_R"].tolist(),
            "green": s["d_G"].tolist(),
            "blue": s["d_B"].tolist(),
        }
    }
    if meta:
        body["meta"] = meta
    return body


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_config_advertises_only_notebook_metrics():
    r = client.get("/api/config")
    assert r.status_code == 200
    body = r.json()
    assert body["measurement_seconds"] == 30
    assert set(body["metrics"]) == {
        "pulse_rate",
        "signal_quality",
        "rhythm",
        "spo2",
        "perfusion_index",
        "respiratory_rate",
    }
    assert "blood_pressure" not in body["metrics"]


def test_process_returns_a_complete_measurement():
    s = synthetic_finger_signals(bpm=72)
    r = client.post(
        "/api/measurement/process",
        json=payload_from(s, {"torch_enabled": True, "facing_mode": "environment"}),
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["status"] == "success"
    assert body["source"] == "frame-signals"
    assert body["pulse_rate"]["fused"] == pytest.approx(72, abs=4)
    assert body["capture"]["fps"] == 30
    assert body["capture"]["torch_enabled"] is True
    assert body["spo2"]["experimental"] is True
    assert "blood_pressure" not in body


def test_process_rejects_mismatched_arrays():
    s = synthetic_finger_signals()
    body = payload_from(s)
    body["signals"]["red"] = body["signals"]["red"][:-5]
    r = client.post("/api/measurement/process", json=body)
    assert r.status_code == 422
    assert "same length" in r.json()["message"]


def test_process_rejects_too_few_samples():
    body = {
        "signals": {
            "timestamps": [0.0],
            "gray": [100.0],
            "red": [100.0],
            "green": [50.0],
            "blue": [30.0],
        }
    }
    r = client.post("/api/measurement/process", json=body)
    assert r.status_code == 422


def test_process_rejects_out_of_range_intensities():
    s = synthetic_finger_signals()
    body = payload_from(s)
    body["signals"]["gray"][10] = 5000.0
    r = client.post("/api/measurement/process", json=body)
    assert r.status_code == 422
    assert "0-255" in r.json()["message"]


def test_process_rejects_a_capture_that_is_too_short():
    s = synthetic_finger_signals(duration_s=9)
    r = client.post("/api/measurement/process", json=payload_from(s))
    assert r.status_code == 422
    assert "required" in r.json()["detail"].lower() or "required" in r.text.lower()


def test_process_rejects_a_flat_signal_without_inventing_a_result():
    n = 900
    t = (np.arange(n) / 30).tolist()
    flat = [128.0] * n
    r = client.post(
        "/api/measurement/process",
        json={"signals": {"timestamps": t, "gray": flat, "red": flat, "green": flat, "blue": flat}},
    )
    assert r.status_code == 422


def test_malformed_json_body_is_rejected_cleanly():
    r = client.post("/api/measurement/process", json={"nope": 1})
    assert r.status_code == 422
    assert "Traceback" not in r.text


def test_errors_never_leak_a_python_traceback():
    s = synthetic_finger_signals(duration_s=5)
    r = client.post("/api/measurement/process", json=payload_from(s))
    assert "Traceback" not in r.text
    assert "File \"" not in r.text


def test_video_endpoint_rejects_unsupported_formats():
    r = client.post(
        "/api/measurement/process-video",
        files={"file": ("notes.txt", b"not a video", "text/plain")},
    )
    assert r.status_code in (415, 503, 404)


def test_video_endpoint_rejects_unreadable_video():
    r = client.post(
        "/api/measurement/process-video",
        files={"file": ("clip.mp4", b"\x00" * 2048, "video/mp4")},
    )
    assert r.status_code in (422, 503, 404)
    assert "Traceback" not in r.text
