"""rPPG preprocessing, pulse-rate estimation and fusion.

Ports notebook cells 11 (preprocessing), 15 (three PR estimators + SQA),
16 (fusion) and 20 (rhythm) of
``reference/Finger_Pulse_rPPG_Analysis_New.ipynb``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import numpy as np
from scipy.signal import cheby1, filtfilt

from .siv_core import amdf_pr_sqa, ppg_spd, rhythm, rhythm_amdf

__all__ = ["PreprocessedSignal", "PulseRateResult", "preprocess", "pulse_rate", "assess_rhythm"]


@dataclass
class PreprocessedSignal:
    """Output of the notebook's ``d -> d_m -> d_a -> cheby1 high-pass -> x`` chain."""

    d: np.ndarray  # raw frame-intensity signal
    d_m: np.ndarray  # detrended (mean removed)
    d_a: np.ndarray  # normalized to +/-1
    x: np.ndarray  # high-pass filtered, re-normalized rPPG signal


@dataclass
class PulseRateResult:
    pr_count: int  # PR1 - count-based
    pr_ppi: int  # PR2 - PPI-based
    pr_amdf: int  # PR3 - AMDF-based
    fused: Optional[int]  # None when the fusion rule is inconclusive
    sqa_flag: int  # 0 = good, 1 = bad (siv_SQA on the full signal)
    peaks: np.ndarray = field(repr=False)  # systolic peak sample indices (SP)
    ppi: np.ndarray = field(repr=False)  # pulse-to-pulse intervals, seconds
    y_smooth: np.ndarray = field(repr=False)  # smoothed signal used by ppg_spd
    amdf_curve: np.ndarray = field(repr=False)  # normalized AMDF
    amdf_locs: np.ndarray = field(repr=False)  # AMDF minima indices


def preprocess(d_gray: np.ndarray, fps: float) -> PreprocessedSignal:
    """Notebook cell 11.

    ``d_gray`` is the per-frame frame-intensity signal. The notebook uses the
    *sum* of the downsampled grayscale frame; because the very next steps remove
    the mean and divide by the peak magnitude, any constant scale factor (e.g.
    using the mean instead of the sum, as the browser client does) cancels out
    exactly and the resulting ``x`` is identical.
    """
    d = np.asarray(d_gray, dtype=float)
    d_m = d - np.mean(d)
    peak = np.max(np.abs(d_m))
    if peak == 0:
        raise ValueError("Frame-intensity signal is constant - no optical variation captured.")
    d_a = d_m / peak

    b0, a0 = cheby1(5, 0.001, 0.5 / (fps / 2), btype="high")
    x = filtfilt(b0, a0, d_a)
    xpeak = np.max(np.abs(x))
    if xpeak == 0:
        raise ValueError("Filtered rPPG signal is empty - no pulsatile content captured.")
    x = x / xpeak

    return PreprocessedSignal(d=d, d_m=d_m, d_a=d_a, x=x)


def _fuse(pr_count: int, pr_ppi: int, pr_amdf: int) -> Optional[int]:
    """Notebook cell 16 - the MATLAB script's range/dist fusion logic."""
    rng = [pr_amdf, pr_count, pr_ppi, pr_amdf]
    dist = np.diff(rng)
    dist1 = (dist > 10).astype(int)
    val = int(np.sum(dist1))

    if val == 0 or val == 2:
        return int(round((pr_count + pr_ppi + pr_amdf) / 3))
    return None  # "Signal Quality is Bad (fusion inconclusive)"


def pulse_rate(x: np.ndarray, fps: float, duration_s: float) -> PulseRateResult:
    """Notebook cells 15 + 16: three independent PR estimates plus fusion."""
    pr1, pr2, sp, ppi, y_smooth, _x_d = ppg_spd(x.copy(), fps, duration_s)
    pr3, sq, amdf_curve, locs2 = amdf_pr_sqa(x.copy(), fps)
    fused = _fuse(int(pr1), int(pr2), int(pr3))

    return PulseRateResult(
        pr_count=int(pr1),
        pr_ppi=int(pr2),
        pr_amdf=int(pr3),
        fused=fused,
        sqa_flag=int(sq),
        peaks=sp,
        ppi=ppi,
        y_smooth=y_smooth,
        amdf_curve=amdf_curve,
        amdf_locs=locs2,
    )


@dataclass
class RhythmResult:
    ppi_regular: bool
    amdf_regular: bool
    segment_pr: np.ndarray = field(repr=False)
    segment_sqa: np.ndarray = field(repr=False)


def assess_rhythm(x: np.ndarray, fps: float, ppi: np.ndarray, ref_pr: int) -> RhythmResult:
    """Notebook cell 20: pulse-interval variability + per-segment AMDF check."""
    rh = rhythm(ppi)
    rh_amdf, _pr_good, pr0, sqa_arr = rhythm_amdf(x.copy(), fps, ref_pr)
    return RhythmResult(
        ppi_regular=bool(rh == 1),
        amdf_regular=bool(rh_amdf == 1),
        segment_pr=pr0,
        segment_sqa=sqa_arr,
    )
