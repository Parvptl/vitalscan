"""Pipeline behaviour: correct results on good signal, honest failures on bad."""

from __future__ import annotations

import numpy as np
import pytest

from app.algorithms.resample import to_uniform_grid
from app.services.pipeline import PipelineError, run_pipeline
from conftest import synthetic_finger_signals


def _run(s):
    return run_pipeline(s["d_gray"], s["d_R"], s["d_G"], s["d_B"], s["fps"], source="frame-signals")


@pytest.mark.parametrize("bpm", [52, 72, 101, 120])
def test_pulse_rate_tracks_the_synthesised_rate(bpm):
    result = _run(synthetic_finger_signals(bpm=bpm))
    assert result["pulse_rate"]["fused"] == pytest.approx(bpm, abs=4)
    for method in ("count_based", "ppi_based", "amdf_based"):
        assert result["pulse_rate"][method] == pytest.approx(bpm, abs=6)


def test_all_notebook_metrics_are_present():
    result = _run(synthetic_finger_signals())
    assert set(result["pulse_rate"]) >= {"count_based", "ppi_based", "amdf_based", "fused"}
    assert result["signal_quality"]["label"] in ("Good", "Bad")
    assert result["rhythm"]["ppi_method"] in ("Regular", "Irregular")
    assert result["rhythm"]["amdf_method"] in ("Regular", "Irregular")
    assert 70 <= result["spo2"]["value"] <= 100
    assert result["perfusion_index"]["value"] > 0
    assert result["respiratory_rate"]["value"] > 0
    assert result["waveform"]["rppg"] and result["waveform"]["peak_indices"]
    assert result["amdf"]["curve"]


def test_no_blood_pressure_or_unsupported_metric_is_reported():
    """Scope guard: only notebook-derived metrics may appear in the response."""
    result = _run(synthetic_finger_signals())
    forbidden = {"blood_pressure", "systolic", "diastolic", "ecg", "glucose", "stress", "temperature", "hrv"}
    assert forbidden.isdisjoint(result.keys())


def test_respiratory_rate_tracks_the_synthesised_breathing_rate():
    result = _run(synthetic_finger_signals(bpm=75, resp_bpm=18.0, duration_s=40))
    assert result["respiratory_rate"]["value"] == pytest.approx(18.0, abs=2.5)


def test_experimental_metrics_are_flagged():
    result = _run(synthetic_finger_signals())
    for key in ("spo2", "perfusion_index", "respiratory_rate"):
        assert result[key]["experimental"] is True


def test_short_capture_is_rejected():
    s = synthetic_finger_signals(duration_s=8)
    with pytest.raises(PipelineError, match="at least"):
        _run(s)


def test_constant_signal_is_rejected_rather_than_guessed():
    n = 900
    flat = np.full(n, 128.0)
    with pytest.raises(ValueError):
        run_pipeline(flat, flat, flat, flat, 30, source="frame-signals")


def test_pure_noise_produces_no_fabricated_confidence():
    """Random input must not silently yield a confident-looking pulse rate."""
    rng = np.random.default_rng(3)
    n, fps = 900, 30
    noise = 128 + rng.normal(0, 4, n)
    result = run_pipeline(noise, noise * 1.6, noise * 0.5, noise * 0.3, fps, source="frame-signals")
    quality_bad = result["signal_quality"]["label"] == "Bad"
    fusion_failed = result["pulse_rate"]["fused"] is None
    wide_spread = result["signal_quality"]["method_spread_bpm"] > 10
    assert quality_bad or fusion_failed or wide_spread


def test_rr_unavailable_reports_none_not_zero():
    """Too few peaks -> respiratory_rate is null, never a placeholder number."""
    fps = 30
    t = np.arange(fps * 25) / fps
    slow = 128 + 3 * np.sin(2 * np.pi * 0.45 * t)  # ~27 bpm, few peaks after filtering
    result = run_pipeline(slow, slow * 1.6, slow * 0.5, slow * 0.3, fps, source="frame-signals")
    assert result["respiratory_rate"] is None or result["respiratory_rate"]["value"] > 0


def test_segment_rhythm_adapts_to_a_30_second_capture():
    result = _run(synthetic_finger_signals(duration_s=30))
    assert result["signal_quality"]["total_segments"] == 3  # 3 x 10 s
    result60 = _run(synthetic_finger_signals(duration_s=60))
    assert result60["signal_quality"]["total_segments"] == 6  # notebook's 6 x 10 s


def test_waveform_payload_is_decimated_for_transport():
    result = _run(synthetic_finger_signals(duration_s=60))
    assert len(result["waveform"]["rppg"]) <= 1800
    assert max(result["waveform"]["peak_indices"]) < len(result["waveform"]["rppg"])


# --------------------------------------------------------------------------
# Uniform resampling (browser time-base adaptation)
# --------------------------------------------------------------------------
def test_uniform_grid_is_a_noop_for_uniform_input():
    s = synthetic_finger_signals()
    u = to_uniform_grid(s["t"], s["d_gray"], s["d_R"], s["d_G"], s["d_B"])
    assert u.fps == 30
    np.testing.assert_allclose(u.gray, s["d_gray"], rtol=1e-9)
    assert u.dropped_samples == 0


def test_uniform_grid_recovers_the_rate_from_jittered_timestamps():
    s = synthetic_finger_signals(bpm=78)
    rng = np.random.default_rng(1)
    jittered = s["t"] + rng.normal(0, 0.004, len(s["t"]))
    jittered = np.maximum.accumulate(jittered)
    u = to_uniform_grid(jittered, s["d_gray"], s["d_R"], s["d_G"], s["d_B"])
    result = run_pipeline(u.gray, u.red, u.green, u.blue, u.fps, source="frame-signals")
    assert result["pulse_rate"]["fused"] == pytest.approx(78, abs=5)


def test_uniform_grid_rejects_an_unusably_low_frame_rate():
    t = np.arange(20) / 2.0  # 2 fps
    v = np.full(20, 100.0)
    with pytest.raises(ValueError, match="too low"):
        to_uniform_grid(t, v, v, v, v)


def test_uniform_grid_drops_duplicate_timestamps():
    t = np.array([0.0, 0.0, 0.1, 0.2, 0.2, 0.3])
    v = np.arange(6, dtype=float)
    u = to_uniform_grid(t, v, v, v, v)
    assert u.dropped_samples == 2
