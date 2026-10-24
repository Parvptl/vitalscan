"""Export SciPy filter coefficients and parity fixtures for the TypeScript port.

The on-device (Android/offline) pipeline must produce the same numbers as the
Python pipeline, which is itself verified against
``reference/Finger_Pulse_rPPG_Analysis_New.ipynb``.

Two things are generated:

1. ``frontend/src/algorithms/filterCoefficients.ts`` - the exact ``b``/``a``
   coefficients SciPy designs for every frame rate the client can produce.
   The TypeScript port therefore never re-implements Chebyshev or Butterworth
   filter design; it uses SciPy's own output.

2. ``frontend/src/algorithms/__fixtures__/parity.json`` - inputs plus the
   expected output of every pipeline stage, so the TypeScript implementation
   can be asserted element-wise against Python in the frontend test suite.

Regenerate with:
    python tools/export_js_reference.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.signal import butter, cheby1

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests"))

from app.algorithms import respiration, rppg, siv_core, spo2  # noqa: E402
from app.algorithms.resample import to_uniform_grid  # noqa: E402
from conftest import synthetic_finger_signals  # noqa: E402

# Frame rates the client can report. `to_uniform_grid` rejects anything below
# 5 fps, and the camera is constrained to a 60 fps maximum.
FPS_MIN, FPS_MAX = 5, 60

# Notebook cell 24: the respiratory stage always resamples to 4 Hz, so its
# band-pass filter is fixed and does not depend on the capture rate.
RR_FS = 4.0
RR_LO, RR_HI = 0.15, 0.7


def _fmt(values) -> str:
    return "[" + ", ".join(repr(float(v)) for v in values) + "]"


# The cardiac band's upper edge is 4.0 Hz, so it only has a valid digital
# design while 4.0 < fps/2, i.e. fps >= 9. Below that SciPy refuses the design
# and the Python pipeline already reports SpO2/PI as unavailable (the stage is
# wrapped in a handler in services/pipeline.py). The TypeScript port must
# behave identically, so we simply emit no coefficients for those rates.
CARDIAC_MIN_FPS = 9


def design_for(fps: int):
    """The two fps-dependent designs used by the pipeline.

    Returns ``(highpass, cardiac_bandpass)``; the band-pass is ``None`` at
    frame rates where 4.0 Hz is at or above Nyquist.
    """
    # rppg.preprocess - notebook cell 11
    hp_b, hp_a = cheby1(5, 0.001, 0.5 / (fps / 2), btype="high")

    # spo2.ac_dc - notebook cell 22, cardiac band 0.7-4.0 Hz
    if fps < CARDIAC_MIN_FPS:
        return (hp_b, hp_a), None
    ny = fps / 2
    bp_b, bp_a = butter(3, [0.7 / ny, 4.0 / ny], btype="band")
    return (hp_b, hp_a), (bp_b, bp_a)


def write_coefficients(path: Path) -> None:
    lines = [
        "/**",
        " * Filter coefficients exported verbatim from SciPy.",
        " *",
        " * GENERATED FILE - do not edit by hand.",
        " * Regenerate with: python backend/tools/export_js_reference.py",
        " *",
        " * The on-device pipeline must match the Python implementation exactly, so",
        " * rather than re-implementing Chebyshev/Butterworth design in TypeScript we",
        " * embed the coefficients SciPy itself produces for every supported frame",
        " * rate. Source designs (notebook cells 11 and 22):",
        " *",
        " *   cheby1(5, 0.001, 0.5 / (fps / 2), btype='high')",
        " *   butter(3, [0.7 / (fps/2), 4.0 / (fps/2)], btype='band')",
        " *   butter(3, [0.15 / 2.0, 0.7 / 2.0], btype='band')   // fixed 4 Hz grid",
        " */",
        "",
        "export interface FilterCoefficients {",
        "  b: number[];",
        "  a: number[];",
        "}",
        "",
        f"export const FPS_MIN = {FPS_MIN};",
        f"export const FPS_MAX = {FPS_MAX};",
        "/** Below this rate 4.0 Hz is at/above Nyquist, so SpO2 and PI are unavailable. */",
        f"export const CARDIAC_MIN_FPS = {CARDIAC_MIN_FPS};",
        "",
        "/** cheby1 high-pass used by the rPPG preprocessing chain, keyed by fps. */",
        "export const HIGHPASS_BY_FPS: Record<number, FilterCoefficients> = {",
    ]

    for fps in range(FPS_MIN, FPS_MAX + 1):
        (hp_b, hp_a), _ = design_for(fps)
        lines.append(f"  {fps}: {{ b: {_fmt(hp_b)}, a: {_fmt(hp_a)} }},")
    lines += ["};", "", "/** butter cardiac band-pass (0.7-4.0 Hz) for SpO2/PI, keyed by fps. */",
              "export const CARDIAC_BANDPASS_BY_FPS: Record<number, FilterCoefficients> = {"]

    for fps in range(FPS_MIN, FPS_MAX + 1):
        _, band = design_for(fps)
        if band is None:
            continue
        bp_b, bp_a = band
        lines.append(f"  {fps}: {{ b: {_fmt(bp_b)}, a: {_fmt(bp_a)} }},")

    rr_b, rr_a = butter(3, [RR_LO / (RR_FS / 2), RR_HI / (RR_FS / 2)], btype="band")
    lines += [
        "};",
        "",
        "/** Respiratory band-pass. Fixed: the RR stage always resamples to 4 Hz. */",
        f"export const RESPIRATORY_BANDPASS: FilterCoefficients = {{ b: {_fmt(rr_b)}, a: {_fmt(rr_a)} }};",
        "",
    ]
    path.write_text("\n".join(lines), encoding="utf-8")


def stage_vectors(bpm: float, fps: int, duration_s: float, resp_bpm: float, seed: int):
    """Run the real Python pipeline and capture every intermediate stage."""
    s = synthetic_finger_signals(
        bpm=bpm, fps=fps, duration_s=duration_s, resp_bpm=resp_bpm, seed=seed
    )
    pre = rppg.preprocess(s["d_gray"], fps)
    pr = rppg.pulse_rate(pre.x, fps, duration_s)
    rh = rppg.assess_rhythm(pre.x, fps, pr.ppi, pr.fused if pr.fused is not None else pr.pr_amdf)
    ox = spo2.estimate_spo2_pi(s["d_R"], s["d_B"], fps)
    rr = respiration.estimate_rr(pr.peaks, fps, pr.y_smooth)

    return {
        "name": f"{int(bpm)}bpm_{fps}fps_{int(duration_s)}s",
        "input": {
            "fps": fps,
            "durationS": duration_s,
            "timestamps": [float(v) for v in s["t"]],
            "gray": [float(v) for v in s["d_gray"]],
            "red": [float(v) for v in s["d_R"]],
            "green": [float(v) for v in s["d_G"]],
            "blue": [float(v) for v in s["d_B"]],
        },
        "expected": {
            "x": [float(v) for v in pre.x],
            "dA": [float(v) for v in pre.d_a],
            "peaks": [int(v) for v in pr.peaks],
            "ppi": [float(v) for v in pr.ppi],
            "ySmooth": [float(v) for v in pr.y_smooth],
            "amdfCurve": [float(v) for v in pr.amdf_curve],
            "amdfLocs": [int(v) for v in pr.amdf_locs],
            "prCount": pr.pr_count,
            "prPpi": pr.pr_ppi,
            "prAmdf": pr.pr_amdf,
            "fused": pr.fused,
            "sqaFlag": pr.sqa_flag,
            "rhythmPpi": rh.ppi_regular,
            "rhythmAmdf": rh.amdf_regular,
            "segmentPr": [float(v) for v in rh.segment_pr],
            "segmentSqa": [float(v) for v in rh.segment_sqa],
            "spo2": ox.spo2,
            "perfusionIndex": ox.perfusion_index,
            "ratioOfRatios": ox.ratio_of_ratios,
            "respiratoryRate": None if rr is None or np.isnan(rr) else float(rr),
        },
    }


def filtfilt_vectors():
    """Direct filtfilt cases, including the FIR moving-average path."""
    rng = np.random.default_rng(42)
    cases = []
    signal = (np.sin(np.arange(400) / 7.0) + 0.3 * rng.normal(size=400)).tolist()

    (hp_b, hp_a), band30 = design_for(30)
    bp_b, bp_a = band30
    for label, b, a in [
        ("cheby1_highpass_30fps", hp_b, hp_a),
        ("butter_cardiac_30fps", bp_b, bp_a),
    ]:
        cases.append(
            {
                "name": label,
                "b": [float(v) for v in b],
                "a": [float(v) for v in a],
                "x": signal,
                "y": [float(v) for v in __import__("scipy.signal", fromlist=["filtfilt"]).filtfilt(b, a, signal)],
            }
        )

    # moving_avg_fil: FIR, a = [1]. Exercises the lfilter_zi FIR path.
    for n in (3, 5, 11):
        cases.append(
            {
                "name": f"moving_avg_{n}",
                "b": [1.0 / n] * n,
                "a": [1.0],
                "x": signal,
                "y": [float(v) for v in siv_core.moving_avg_fil(np.asarray(signal), n)],
            }
        )
    return cases


def resample_vectors():
    """Jittered-timestamp resampling, the browser time-base adaptation."""
    s = synthetic_finger_signals(bpm=78, fps=30, duration_s=30, seed=5)
    rng = np.random.default_rng(1)
    t = np.maximum.accumulate(s["t"] + rng.normal(0, 0.004, len(s["t"])))
    u = to_uniform_grid(t, s["d_gray"], s["d_R"], s["d_G"], s["d_B"])
    return {
        "input": {
            "timestamps": [float(v) for v in t],
            "gray": [float(v) for v in s["d_gray"]],
            "red": [float(v) for v in s["d_R"]],
            "green": [float(v) for v in s["d_G"]],
            "blue": [float(v) for v in s["d_B"]],
        },
        "expected": {
            "fps": u.fps,
            "effectiveFps": u.effective_fps,
            "durationS": u.duration_s,
            "droppedSamples": u.dropped_samples,
            "gray": [float(v) for v in u.gray],
            "red": [float(v) for v in u.red],
        },
    }


def main() -> None:
    algo_dir = ROOT / "frontend" / "src" / "algorithms"
    fixtures_dir = algo_dir / "__fixtures__"
    algo_dir.mkdir(parents=True, exist_ok=True)
    fixtures_dir.mkdir(parents=True, exist_ok=True)

    write_coefficients(algo_dir / "filterCoefficients.ts")

    fixtures = {
        "filtfilt": filtfilt_vectors(),
        "resample": resample_vectors(),
        "pipeline": [
            stage_vectors(74, 30, 30.0, 16.0, 7),
            stage_vectors(52, 30, 30.0, 12.0, 3),
            stage_vectors(101, 30, 60.0, 18.0, 11),
            stage_vectors(88, 25, 30.0, 15.0, 2),
        ],
    }
    (fixtures_dir / "parity.json").write_text(json.dumps(fixtures), encoding="utf-8")

    coeff_kb = (algo_dir / "filterCoefficients.ts").stat().st_size / 1024
    fx_kb = (fixtures_dir / "parity.json").stat().st_size / 1024
    print(f"filterCoefficients.ts  {coeff_kb:7.1f} KB  (fps {FPS_MIN}-{FPS_MAX})")
    print(f"parity.json            {fx_kb:7.1f} KB  "
          f"({len(fixtures['filtfilt'])} filtfilt, {len(fixtures['pipeline'])} pipeline cases)")


if __name__ == "__main__":
    main()
