"""Measurement pipeline orchestration.

Runs the notebook's pipeline end to end:

    frame signals -> preprocess -> peak detection -> PR estimators -> fusion
                  -> SQA -> rhythm -> SpO2 / PI -> RR

Every value returned here is produced by the notebook-derived algorithms in
``app.algorithms``. Nothing is synthesised: when a stage cannot produce a
result the corresponding field is ``None`` and an explanatory note is attached.
"""

from __future__ import annotations

import logging
import math
from typing import Any, Optional

import numpy as np

from ..algorithms import respiration, rppg, spo2
from ..config import settings

logger = logging.getLogger(__name__)

# Number of waveform samples sent to the client for plotting. The raw signal is
# kept server-side only for the duration of the request.
WAVEFORM_MAX_POINTS = 1800


class PipelineError(ValueError):
    """Raised when the captured signal cannot be analysed at all."""


def _decimate_for_plot(x: np.ndarray, peaks: np.ndarray, max_points: int = WAVEFORM_MAX_POINTS):
    """Downsample a waveform for transport, keeping peak indices consistent."""
    n = len(x)
    if n <= max_points:
        return x.astype(float).tolist(), [int(p) for p in peaks if 0 <= p < n], 1
    step = int(math.ceil(n / max_points))
    idx = np.arange(0, n, step)
    mapped = sorted({int(p // step) for p in peaks if 0 <= p < n})
    mapped = [p for p in mapped if p < len(idx)]
    return x[idx].astype(float).tolist(), mapped, step


def _quality_label(sqa_flag: int, good_segments: int, total_segments: int) -> str:
    """Notebook SQA is binary (0 good / 1 bad). We surface that verdict as-is."""
    return "Bad" if sqa_flag == 1 else "Good"


def run_pipeline(
    d_gray: np.ndarray,
    d_R: np.ndarray,
    d_G: np.ndarray,
    d_B: np.ndarray,
    fps: int,
    *,
    source: str,
    capture_meta: Optional[dict] = None,
) -> dict[str, Any]:
    n = len(d_gray)
    duration_s = n / fps

    if duration_s < settings.min_analysis_seconds:
        raise PipelineError(
            f"Only {duration_s:.1f}s of signal was captured; at least "
            f"{settings.min_analysis_seconds}s is required for analysis."
        )

    notes: list[str] = []

    # --- Stage 1: preprocessing (notebook cell 11) -------------------------
    pre = rppg.preprocess(d_gray, fps)

    # --- Stage 2/3: peaks, three PR estimators, fusion (cells 15 + 16) -----
    pr = rppg.pulse_rate(pre.x, fps, duration_s)
    if pr.fused is None:
        notes.append(
            "The three pulse-rate estimates disagreed by more than the fusion rule allows, "
            "so no fused pulse rate is reported."
        )

    # --- Stage 4: rhythm (cell 20) ----------------------------------------
    ref_pr = pr.fused if pr.fused is not None else pr.pr_amdf
    rhythm_res = rppg.assess_rhythm(pre.x, fps, pr.ppi, ref_pr)
    total_segments = int(len(rhythm_res.segment_sqa))
    good_segments = int(np.count_nonzero(rhythm_res.segment_sqa == 0))
    if total_segments < 2:
        notes.append(
            "Fewer than two 10-second segments were available, so the per-segment "
            "AMDF rhythm check is inconclusive."
        )

    # --- Stage 5: SpO2 + PI (cell 22) -------------------------------------
    spo2_payload = None
    try:
        s = spo2.estimate_spo2_pi(d_R, d_B, fps)
        spo2_payload = s
    except Exception as exc:  # noqa: BLE001 - reported to the user as unavailable
        logger.warning("SpO2/PI stage failed: %s", exc)
        notes.append("SpO2 and perfusion index could not be computed from the captured colour signal.")

    # --- Stage 6: respiratory rate (cell 24) ------------------------------
    rr_value = respiration.estimate_rr(pr.peaks, fps, pr.y_smooth)
    if rr_value is None or (isinstance(rr_value, float) and math.isnan(rr_value)):
        rr_value = None
        notes.append("Too few pulse peaks were detected to estimate a respiratory rate.")

    waveform, waveform_peaks, decimation = _decimate_for_plot(pre.x, pr.peaks)
    raw_waveform, _, _ = _decimate_for_plot(pre.d_a, np.array([], dtype=int))
    amdf_curve, amdf_locs, _ = _decimate_for_plot(
        pr.amdf_curve, pr.amdf_locs, max_points=len(pr.amdf_curve)
    )

    quality_label = _quality_label(pr.sqa_flag, good_segments, total_segments)

    result: dict[str, Any] = {
        "status": "success",
        "source": source,
        "capture": {
            "fps": int(fps),
            "duration_s": round(duration_s, 2),
            "samples": int(n),
            **(capture_meta or {}),
        },
        "pulse_rate": {
            "count_based": pr.pr_count,
            "ppi_based": pr.pr_ppi,
            "amdf_based": pr.pr_amdf,
            "fused": pr.fused,
            "unit": "bpm",
            "peaks_detected": int(len(pr.peaks)),
        },
        "signal_quality": {
            "sqa_flag": pr.sqa_flag,
            "label": quality_label,
            "method_spread_bpm": int(
                max(pr.pr_count, pr.pr_ppi, pr.pr_amdf) - min(pr.pr_count, pr.pr_ppi, pr.pr_amdf)
            ),
            "good_segments": good_segments,
            "total_segments": total_segments,
        },
        "rhythm": {
            "ppi_method": "Regular" if rhythm_res.ppi_regular else "Irregular",
            "amdf_method": "Regular" if rhythm_res.amdf_regular else "Irregular",
            "segment_pulse_rates": [int(v) for v in rhythm_res.segment_pr.tolist()],
            "segment_quality": [int(v) for v in rhythm_res.segment_sqa.tolist()],
        },
        "spo2": None
        if spo2_payload is None
        else {
            "value": round(spo2_payload.spo2, 1),
            "unit": "%",
            "experimental": True,
            "ratio_of_ratios": round(spo2_payload.ratio_of_ratios, 4),
            "ac_red": spo2_payload.ac_red,
            "dc_red": spo2_payload.dc_red,
            "ac_blue": spo2_payload.ac_blue,
            "dc_blue": spo2_payload.dc_blue,
            "calibration": f"SpO2 = {spo2.SPO2_SLOPE} * R + {spo2.SPO2_INTERCEPT}",
        },
        "perfusion_index": None
        if spo2_payload is None
        else {
            "value": round(spo2_payload.perfusion_index, 2),
            "unit": "%",
            "experimental": True,
        },
        "respiratory_rate": None
        if rr_value is None
        else {
            "value": round(float(rr_value), 1),
            "unit": "breaths/min",
            "experimental": True,
        },
        "waveform": {
            "rppg": waveform,
            "raw": raw_waveform,
            "peak_indices": waveform_peaks,
            "decimation": decimation,
            "fps": int(fps),
        },
        "amdf": {
            "curve": amdf_curve,
            "minima_indices": amdf_locs,
        },
        "pulse_intervals_s": [round(float(v), 4) for v in pr.ppi.tolist()],
        "notes": notes,
    }
    return result
