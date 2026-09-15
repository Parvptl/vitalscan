"""Respiratory Rate from pulse-amplitude (frequency/amplitude) modulation.

Port of notebook cell 24 of ``reference/Finger_Pulse_rPPG_Analysis_New.ipynb``.

EXPERIMENTAL, as stated in the notebook. The band's lower edge is 0.15 Hz
(9 breaths/min) rather than 0.1 Hz - the notebook explains that the wider band
picked up slow drift (finger-pressure or lighting changes) and misreported it
as an implausibly slow breathing rate. That choice, the explicit linear
detrend, the 4 Hz resample rate and the 4096-point zero-padded FFT are all
preserved verbatim.
"""

from __future__ import annotations

import numpy as np
from scipy.signal import butter, detrend, filtfilt

__all__ = ["estimate_rr", "RR_BAND_LOW_HZ", "RR_BAND_HIGH_HZ", "RR_RESAMPLE_HZ"]

RR_BAND_LOW_HZ = 0.15  # 9 breaths/min
RR_BAND_HIGH_HZ = 0.7  # 42 breaths/min
RR_RESAMPLE_HZ = 4.0


def estimate_rr(SP_idx, fs, y_signal):
    """Notebook cell 24. Returns breaths/min, or ``nan`` when not estimable."""
    SP_idx = np.asarray(SP_idx, dtype=int)
    y_signal = np.asarray(y_signal, dtype=float)
    if len(SP_idx) < 4:
        return np.nan
    peak_times = SP_idx / fs
    peak_amps = y_signal[SP_idx]

    fs_u = RR_RESAMPLE_HZ  # uniform resample rate for the amplitude-envelope series
    t_uniform = np.arange(peak_times[0], peak_times[-1], 1 / fs_u)
    if len(t_uniform) < 16:
        return np.nan
    amp_interp = np.interp(t_uniform, peak_times, peak_amps)
    amp_interp = detrend(amp_interp)  # remove slow drift before filtering/peak-picking

    ny = fs_u / 2
    lo, hi = RR_BAND_LOW_HZ, min(RR_BAND_HIGH_HZ, ny * 0.95)  # 9-42 breaths/min
    b, a = butter(3, [lo / ny, hi / ny], btype="band")
    resp = filtfilt(b, a, amp_interp)

    nfft = 4096  # zero-pad for finer frequency resolution than a short window would give
    freqs = np.fft.rfftfreq(nfft, d=1 / fs_u)
    spectrum = np.abs(np.fft.rfft(resp, n=nfft)) ** 2
    band = (freqs >= lo) & (freqs <= hi)
    if not np.any(band):
        return np.nan
    peak_f = freqs[band][np.argmax(spectrum[band])]
    return peak_f * 60
