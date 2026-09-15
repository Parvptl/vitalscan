"""SpO2 and Perfusion Index.

Port of notebook cell 22 of ``reference/Finger_Pulse_rPPG_Analysis_New.ipynb``.

Both outputs are EXPERIMENTAL. The notebook states this explicitly: SpO2 here
is derived from a standard RGB camera (Red/Blue ratio-of-ratios) with generic
calibration constants, not from a clinically calibrated red/infrared pulse
oximeter. The calibration ``SpO2 = -1.1 * R + 98`` is preserved verbatim.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy.signal import butter, filtfilt

__all__ = ["SpO2Result", "bandpass", "ac_dc", "estimate_spo2_pi", "SPO2_SLOPE", "SPO2_INTERCEPT"]

# Notebook calibration constants - replace only with a real reference-oximeter
# calibration, never with a guess.
SPO2_SLOPE = -1.1
SPO2_INTERCEPT = 98.0


@dataclass
class SpO2Result:
    spo2: float  # percent, clipped to [70, 100] as in the notebook
    perfusion_index: float  # percent, AC/DC of the red channel
    ratio_of_ratios: float
    ac_red: float
    dc_red: float
    ac_blue: float
    dc_blue: float


def bandpass(sig, fs, lo, hi, order=3):
    """Notebook cell 22 helper."""
    ny = fs / 2
    b, a = butter(order, [lo / ny, hi / ny], btype="band")
    return filtfilt(b, a, sig)


def ac_dc(channel_sig, fs, lo=0.7, hi=4.0):
    """Notebook cell 22 helper - AC (cardiac-band std) and DC (mean) of a channel."""
    dc = np.mean(channel_sig)
    ac_sig = bandpass(channel_sig, fs, lo, hi)  # isolate the cardiac band (~42-240 bpm)
    ac = np.std(ac_sig)
    return ac, dc


def estimate_spo2_pi(d_R: np.ndarray, d_B: np.ndarray, fps: float) -> SpO2Result:
    """Notebook cell 22.

    ``d_R``/``d_B`` are the per-frame mean red/blue channel intensities. The
    ratio-of-ratios and PI are both scale-invariant, so the browser client's
    per-frame channel means are directly equivalent to the notebook's.
    """
    ac_r, dc_r = ac_dc(np.asarray(d_R, dtype=float), fps)
    ac_b, dc_b = ac_dc(np.asarray(d_B, dtype=float), fps)

    if dc_r == 0 or dc_b == 0 or ac_b == 0:
        raise ValueError("Red/blue channel signal has no usable DC or AC component.")

    r_ratio = (ac_r / dc_r) / (ac_b / dc_b)
    spo2 = float(np.clip(SPO2_SLOPE * r_ratio + SPO2_INTERCEPT, 70, 100))
    pi = (ac_r / dc_r) * 100

    return SpO2Result(
        spo2=spo2,
        perfusion_index=float(pi),
        ratio_of_ratios=float(r_ratio),
        ac_red=float(ac_r),
        dc_red=float(dc_r),
        ac_blue=float(ac_b),
        dc_blue=float(dc_b),
    )
