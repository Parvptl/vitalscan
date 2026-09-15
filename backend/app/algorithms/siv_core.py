"""Core signal-processing primitives.

Direct, unmodified translations of the ``siv_*`` helper functions defined in
``reference/Finger_Pulse_rPPG_Analysis_New.ipynb`` (cell 13), which are
themselves Python ports of the original MATLAB ``siv_*.m`` files.

Nothing in this module changes the mathematical behaviour of the notebook:
constants, thresholds, filter orders and comparison operators are preserved
verbatim. The only additions are type hints and docstring references.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import filtfilt

__all__ = [
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


def moving_avg_fil(x, N):
    """siv_moving_avg_fil.m - zero-phase moving-average (box) filter."""
    N = int(N)
    b = np.ones(N) / N
    a = [1.0]
    padlen = 3 * (max(len(a), len(b)) - 1)
    if len(x) <= padlen:
        return filtfilt(b, a, x, padlen=max(0, len(x) - 2))
    return filtfilt(b, a, x)


def th_cross(x, m="b", th=0.0):
    """siv_th_cross.m - generic threshold crossing.

    ``m``: 'p' = positive-going, 'n' = negative-going, 'b' = both.
    """
    x = np.asarray(x)
    s = (x >= th).astype(int)
    k = s[1:] - s[:-1]
    if "p" in m:
        f = np.where(k > 0)[0]
    elif "n" in m:
        f = np.where(k < 0)[0]
    else:
        f = np.where(k != 0)[0]
    return f


def neg_th_cross(ydif, th):
    """siv_neg_th_cross.m - negative-going threshold crossing with 1-sample
    refinement (used to locate peaks)."""
    ydif = np.asarray(ydif)
    L = len(ydif)
    out = []
    i = 0
    while i < L - 3:
        if ydif[i] > th and ydif[i + 1] <= th:
            if abs(ydif[i + 1]) > abs(ydif[i + 2]):
                out.append(i + 2)
            else:
                out.append(i + 1)
        i += 1
    return np.array(out, dtype=int)


def peakanno_amdf(ym):
    """siv_peakanno_AMDF.m - locate the first prominent peak of ``ym``
    (called with ``ym = -AMDF``)."""
    ym = np.asarray(ym, dtype=float)
    ydif = np.gradient(ym)
    ydif = moving_avg_fil(ydif, 3)
    if len(ydif) >= 10:
        ydif[0:10] = ydif[9]
    mx = np.max(np.abs(ydif))
    if mx == 0:
        mx = 1.0
    ydif = ydif / mx
    zerocross = neg_th_cross(ydif, -0.1)
    if len(zerocross) < 2:
        zerocross = np.array([0, 0])  # fallback for the (rare) no-peak edge case
    return zerocross


def amdf(x, max_lag=None):
    """siv_AMDF_04.m - Average Magnitude Difference Function (vectorized).

    ``D[i]`` corresponds to lag ``i + 1``.
    """
    x = np.asarray(x, dtype=float)
    N = len(x)
    if max_lag is None:
        max_lag = N - 1
    max_lag = min(max_lag, N - 1)
    D = np.zeros(max_lag)
    for k in range(1, max_lag + 1):
        D[k - 1] = np.mean(np.abs(x[: N - k] - x[k:N]))
    return D


def sqa(x, AMDF, locs2, PR):
    """siv_SQA.m - signal-quality assessment. Returns 0 = good, 1 = bad."""
    th, thm = 0.1, -0.1
    cross_th_o = th_cross(x, "b", th)
    cross_thm_o = th_cross(x, "b", thm)

    N = len(locs2)
    if locs2[0] == 0 or (len(locs2) > 1 and locs2[1] == 0):
        N = 0

    mag = abs(len(cross_th_o) - len(cross_thm_o))

    if N < 2 or PR < 30 or PR > 300:
        return 1
    elif (AMDF[locs2[0]] > -0.25 and AMDF[locs2[1]] > -0.25) and mag > 5:
        return 1
    elif (AMDF[locs2[0]] < -0.5 and AMDF[locs2[1]] < -0.5) and mag <= 5:
        return 0
    else:
        rng = np.concatenate(([0], locs2))
        distance = np.diff(rng)
        dist = np.diff(distance)
        SQ = 0
        for k in dist:
            SQ = 1 if k > 5 else 0
            if SQ == 1:
                break
        return SQ


def amdf_pr_sqa(x, Fs):
    """siv_AMDF_PR_SQA.m - pulse rate + SQA from the AMDF's first minimum."""
    AMDF_h = int(round(2 * (60 * Fs) / 30))  # max lag considered (~15 bpm floor)
    AMDFo = amdf(x, max_lag=AMDF_h)
    A = AMDFo[:AMDF_h].copy()
    A = A - np.mean(A)
    famp = np.max(np.abs(A))
    if famp == 0:
        famp = 1.0
    A = A / famp

    locs2 = peakanno_amdf(-A)
    if locs2[0] > 5 and locs2[0] <= AMDF_h - 5:
        lo, hi = locs2[0] - 5, locs2[0] + 6
        ref = np.argmin(A[lo:hi])
        locs2[0] = lo + ref

    lag = locs2[0] + 1  # array index -> lag in samples
    PR = int(np.floor(60 * Fs / lag)) if lag > 0 else 0

    SQ = sqa(x, A, locs2, PR)
    return PR, SQ, A, locs2


def ppg_spd(y, Fs, t):
    """siv_PPG_SPD.m - systolic-peak detection + count/PPI-based pulse rate."""
    order = max(int(np.ceil(0.1 * Fs)), 1)
    y = moving_avg_fil(y, order)
    x_d = np.gradient(y)
    x_d = moving_avg_fil(x_d, order)
    mx = np.max(np.abs(x_d))
    if mx == 0:
        mx = 1.0
    x_d = x_d / mx

    SP = neg_th_cross(x_d, 0.0)  # systolic peak sample indices
    PPI = np.diff(SP) / Fs  # pulse-to-pulse intervals (s)
    N = len(SP)
    PPI_avg = np.mean(PPI) if len(PPI) else np.nan
    PR1 = round(N * 60 / t)
    PR2 = round(60 / PPI_avg) if PPI_avg and not np.isnan(PPI_avg) else 0
    return PR1, PR2, SP, PPI, y, x_d


def rhythm(RRI):
    """siv_Rhythm.m - regular (1) / irregular (0) from pulse-interval variability."""
    RRI = np.asarray(RRI)
    if len(RRI) == 0:
        return 0
    RRI_avg = np.mean(RRI)
    RRI_deci = np.abs(RRI - RRI_avg) > 0.12
    return 0 if np.sum(RRI_deci) > 0 else 1


def rhythm_amdf(x, Fs, Ref_PR, n_segments=6, seg_seconds=10):
    """siv_Rhythm_AMDF.m - per-10s-segment AMDF pulse-rate check against a
    reference PR.

    The notebook calls this with the default ``n_segments=6`` (6 x 10 s = 60 s).
    The loop already breaks when a segment would run past the end of ``x``, so a
    shorter recording (e.g. the app's 30 s capture) simply yields fewer
    segments - the per-segment logic is untouched.
    """
    BL = int(seg_seconds * Fs)
    PR = np.zeros(n_segments)
    SQA_arr = np.zeros(n_segments)
    n_done = 0

    for i in range(n_segments):
        n1, ne = i * BL, i * BL + BL
        if ne > len(x):
            break
        x1 = x[n1:ne]
        n_done += 1

        A = amdf(x1)
        A = A - np.mean(A)
        famp = np.max(np.abs(A))
        if famp == 0:
            famp = 1.0
        A = A / famp

        locs2 = peakanno_amdf(-A)
        if locs2[0] > 5 and locs2[0] <= len(A) - 5:
            lo, hi = locs2[0] - 5, locs2[0] + 6
            ref = np.argmin(A[lo:hi])
            locs2[0] = lo + ref

        lag = locs2[0] + 1
        PR[i] = np.floor(60 * Fs / lag) if lag > 0 else 0
        SQA_arr[i] = sqa(x1, A, locs2, PR[i])

    PR, SQA_arr = PR[:n_done], SQA_arr[:n_done]
    PR0 = PR.copy()
    PR_good = PR[SQA_arr == 0]

    if len(PR_good) > 1:
        PR_deci = np.abs(PR_good - Ref_PR) > 5
        Rhythm_flag = 0 if np.sum(PR_deci) > 0 else 1
    else:
        # Notebook prints "Not enough good-quality segments to assess rhythm".
        Rhythm_flag = 0

    return Rhythm_flag, PR_good, PR0, SQA_arr
