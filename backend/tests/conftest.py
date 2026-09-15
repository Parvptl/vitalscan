"""Shared fixtures: synthetic finger-PPG signals and the notebook namespace."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
NOTEBOOK = ROOT / "reference" / "Finger_Pulse_rPPG_Analysis_New.ipynb"

if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))


def synthetic_finger_signals(
    bpm: float = 72.0,
    fps: int = 30,
    duration_s: float = 30.0,
    resp_bpm: float = 15.0,
    noise: float = 0.0,
    seed: int = 7,
):
    """A physiologically-shaped finger-PPG signal for deterministic tests.

    Sharp systolic upstroke + dicrotic notch, respiratory amplitude modulation,
    a slow baseline drift, and per-channel DC levels resembling a torch-lit
    fingertip (red saturated high, blue low).
    """
    rng = np.random.default_rng(seed)
    n = int(round(fps * duration_s))
    t = np.arange(n) / fps
    f = bpm / 60.0

    phase = 2 * np.pi * f * t
    pulse = np.sin(phase) + 0.35 * np.sin(2 * phase + 0.9) + 0.12 * np.sin(3 * phase + 0.3)
    resp = 1.0 + 0.25 * np.sin(2 * np.pi * (resp_bpm / 60.0) * t)
    drift = 0.6 * np.sin(2 * np.pi * 0.03 * t)

    ac = pulse * resp
    if noise:
        ac = ac + rng.normal(0, noise, n)

    # Torch-lit fingertip: strong red, weak blue; pulsatility strongest in red.
    d_R = 205.0 + drift * 2.0 + ac * 1.8
    d_G = 60.0 + drift * 0.8 + ac * 0.5
    d_B = 35.0 + drift * 0.5 + ac * 0.25
    d_gray = 0.299 * d_R + 0.587 * d_G + 0.114 * d_B

    return {
        "t": t,
        "fps": fps,
        "duration_s": duration_s,
        "d_gray": d_gray,
        "d_R": d_R,
        "d_G": d_G,
        "d_B": d_B,
    }


@pytest.fixture(scope="session")
def notebook_namespace() -> dict:
    """Execute the notebook's own function-definition cells.

    This makes the notebook the literal source of truth for the parity tests:
    the ported modules are compared against code executed straight out of the
    .ipynb, not against a hand-copied snapshot of it.
    """
    nb = json.loads(NOTEBOOK.read_text(encoding="utf-8"))
    ns: dict = {}
    exec("import numpy as np\nfrom scipy.signal import filtfilt, cheby1, butter, welch", ns)

    for cell in nb["cells"]:
        if cell["cell_type"] != "code":
            continue
        src = "".join(cell["source"])
        # Only the pure function-definition cells: skip video I/O, plotting,
        # printing and anything touching the (absent) sample video.
        if src.lstrip().startswith("def moving_avg_fil") or src.lstrip().startswith("def bandpass"):
            exec(src.split("AC_R, DC_R")[0], ns)
        elif "def estimate_rr" in src:
            exec(src.split("RR = estimate_rr")[0], ns)
    return ns


@pytest.fixture(scope="session")
def signals():
    return synthetic_finger_signals()
