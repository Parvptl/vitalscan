"""Parity tests: the ported modules must match the notebook's own code.

The ``notebook_namespace`` fixture executes the function definitions straight
out of ``reference/Finger_Pulse_rPPG_Analysis_New.ipynb``. Every assertion here
compares our production implementation against that live notebook code, so any
future drift in constants, thresholds or formulas fails the suite.
"""

from __future__ import annotations

import numpy as np
import pytest
from scipy.signal import cheby1, filtfilt

from app.algorithms import respiration, rppg, siv_core, spo2

SIV_FUNCTIONS = [
    "moving_avg_fil",
    "th_cross",
    "neg_th_cross",
    "peakanno_amdf",
    "amdf",
    "sqa",
    "amdf_pr_sqa",
    "ppg_spd",
    "rhythm",
    "rhythm_amdf",
]


def test_notebook_defines_every_ported_function(notebook_namespace):
    for name in SIV_FUNCTIONS + ["bandpass", "ac_dc", "estimate_rr"]:
        assert name in notebook_namespace, f"{name} missing from the notebook namespace"


def test_moving_avg_fil_matches(notebook_namespace, signals):
    x = signals["d_gray"]
    for n in (3, 5, 11):
        np.testing.assert_allclose(
            siv_core.moving_avg_fil(x, n), notebook_namespace["moving_avg_fil"](x, n)
        )


def test_th_cross_matches(notebook_namespace, signals):
    x = signals["d_gray"] - np.mean(signals["d_gray"])
    for mode in ("p", "n", "b"):
        np.testing.assert_array_equal(
            siv_core.th_cross(x, mode, 0.1), notebook_namespace["th_cross"](x, mode, 0.1)
        )


def test_amdf_matches(notebook_namespace, signals):
    x = (signals["d_gray"] - np.mean(signals["d_gray"]))[:400]
    np.testing.assert_allclose(
        siv_core.amdf(x, 120), notebook_namespace["amdf"](x, 120), rtol=1e-12
    )


def _preprocessed(signals):
    d = signals["d_gray"]
    d_m = d - np.mean(d)
    d_a = d_m / np.max(np.abs(d_m))
    b0, a0 = cheby1(5, 0.001, 0.5 / (signals["fps"] / 2), btype="high")
    x = filtfilt(b0, a0, d_a)
    return x / np.max(np.abs(x))


def test_preprocess_matches_notebook_chain(signals):
    """rppg.preprocess reproduces the notebook's d -> d_m -> d_a -> cheby1 chain."""
    pre = rppg.preprocess(signals["d_gray"], signals["fps"])
    np.testing.assert_allclose(pre.x, _preprocessed(signals), rtol=1e-12, atol=1e-12)


def test_preprocess_is_scale_invariant(signals):
    """The notebook sums the grayscale frame; the browser sends the mean.

    Detrend + peak normalisation cancels any constant factor, so both give the
    same rPPG signal - this test pins that equivalence down.
    """
    a = rppg.preprocess(signals["d_gray"], signals["fps"]).x
    b = rppg.preprocess(signals["d_gray"] * 3072.0, signals["fps"]).x
    np.testing.assert_allclose(a, b, rtol=1e-9, atol=1e-9)


def test_ppg_spd_matches(notebook_namespace, signals):
    x = _preprocessed(signals)
    fps, t = signals["fps"], signals["duration_s"]
    mine = siv_core.ppg_spd(x.copy(), fps, t)
    theirs = notebook_namespace["ppg_spd"](x.copy(), fps, t)
    assert mine[0] == theirs[0]  # PR1
    assert mine[1] == theirs[1]  # PR2
    np.testing.assert_array_equal(mine[2], theirs[2])  # SP
    np.testing.assert_allclose(mine[3], theirs[3])  # PPI


def test_amdf_pr_sqa_matches(notebook_namespace, signals):
    x = _preprocessed(signals)
    mine = siv_core.amdf_pr_sqa(x.copy(), signals["fps"])
    theirs = notebook_namespace["amdf_pr_sqa"](x.copy(), signals["fps"])
    assert mine[0] == theirs[0]  # PR3
    assert mine[1] == theirs[1]  # SQ
    np.testing.assert_allclose(mine[2], theirs[2])
    np.testing.assert_array_equal(mine[3], theirs[3])


def test_rhythm_matches(notebook_namespace, signals):
    x = _preprocessed(signals)
    _, _, sp, ppi, *_ = siv_core.ppg_spd(x.copy(), signals["fps"], signals["duration_s"])
    assert siv_core.rhythm(ppi) == notebook_namespace["rhythm"](ppi)


def test_rhythm_amdf_matches(notebook_namespace, signals):
    x = _preprocessed(signals)
    mine = siv_core.rhythm_amdf(x.copy(), signals["fps"], 72)
    theirs = notebook_namespace["rhythm_amdf"](x.copy(), signals["fps"], 72)
    assert mine[0] == theirs[0]
    np.testing.assert_array_equal(mine[2], theirs[2])
    np.testing.assert_array_equal(mine[3], theirs[3])


def test_spo2_and_pi_match(notebook_namespace, signals):
    fps = signals["fps"]
    ac_r, dc_r = notebook_namespace["ac_dc"](signals["d_R"], fps)
    ac_b, dc_b = notebook_namespace["ac_dc"](signals["d_B"], fps)
    r_ratio = (ac_r / dc_r) / (ac_b / dc_b)
    expected_spo2 = float(np.clip(-1.1 * r_ratio + 98, 70, 100))
    expected_pi = (ac_r / dc_r) * 100

    result = spo2.estimate_spo2_pi(signals["d_R"], signals["d_B"], fps)
    assert result.spo2 == pytest.approx(expected_spo2, rel=1e-12)
    assert result.perfusion_index == pytest.approx(expected_pi, rel=1e-12)
    assert result.ratio_of_ratios == pytest.approx(r_ratio, rel=1e-12)


def test_spo2_calibration_constants_unchanged():
    """Guards the notebook's calibration: SpO2 = -1.1 * R + 98."""
    assert spo2.SPO2_SLOPE == -1.1
    assert spo2.SPO2_INTERCEPT == 98.0


def test_rr_matches(notebook_namespace, signals):
    x = _preprocessed(signals)
    _, _, sp, _, y_smooth, _ = siv_core.ppg_spd(x.copy(), signals["fps"], signals["duration_s"])
    mine = respiration.estimate_rr(sp, signals["fps"], y_smooth)
    theirs = notebook_namespace["estimate_rr"](sp, signals["fps"], y_smooth)
    assert mine == pytest.approx(theirs, rel=1e-12)


def test_rr_band_constants_unchanged():
    """The notebook deliberately uses a 0.15 Hz lower edge, not 0.1 Hz."""
    assert respiration.RR_BAND_LOW_HZ == 0.15
    assert respiration.RR_BAND_HIGH_HZ == 0.7
    assert respiration.RR_RESAMPLE_HZ == 4.0
