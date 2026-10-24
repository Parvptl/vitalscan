"""Generate the Android launcher icons for the VitalScan APK.

Lives under `backend/tools` because it uses the backend virtualenv's OpenCV and
NumPy; it writes into `frontend/android/app/src/main/res`.

Produces the three sets Android expects:

* ``ic_launcher.png``            legacy rounded-square icon (48-192 px)
* ``ic_launcher_round.png``      legacy circular icon (48-192 px)
* ``ic_launcher_foreground.png`` adaptive-icon foreground (108-432 px)

ADAPTIVE ICON SAFE ZONE
-----------------------
The adaptive foreground is a 108dp canvas of which only the central 66dp is
guaranteed to survive the launcher's mask - the outer 21dp on each side may be
cropped to a circle, squircle, rounded square or teardrop depending on the
device. The mark is therefore scaled to sit well inside that 61% safe zone, and
the solid brand colour is supplied separately as the adaptive background so the
parallax effect works correctly.

Everything is rendered at 4x and downsampled with INTER_AREA for clean edges.

Regenerate with:
    cd backend && .venv/Scripts/python tools/generate_launcher_icons.py
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RES = ROOT / "frontend" / "android" / "app" / "src" / "main" / "res"

# VitalScan brand teal, matching --vs-accent / --vs-accent-strong in tokens.css.
TEAL_TOP = (107, 122, 15)  # BGR of #0f7a6b
TEAL_BOTTOM = (81, 93, 10)  # BGR of #0a5d51
BRAND_HEX = "#0F7A6B"

SUPERSAMPLE = 4

# density bucket -> (legacy icon px, adaptive foreground px)
DENSITIES = {
    "mdpi": (48, 108),
    "hdpi": (72, 162),
    "xhdpi": (96, 216),
    "xxhdpi": (144, 324),
    "xxxhdpi": (192, 432),
}

# The pulse trace, in units of the mark's bounding box: x across, y about the
# centre line. Same path as the web favicon and PWA icons.
PULSE = [
    (0.00, 0.00),
    (0.24, 0.00),
    (0.34, -0.26),
    (0.47, 0.30),
    (0.58, -0.12),
    (0.66, 0.00),
    (1.00, 0.00),
]

# Mark width as a fraction of the canvas.
LEGACY_MARK_SCALE = 0.78
# Chosen so the *stroked* mark, not just the path, clears the 0.611 safe zone
# with margin: the round caps add STROKE_RATIO/2 on each side, so the inked
# bounding box ends up spanning roughly 0.25-0.75 of the canvas.
ADAPTIVE_MARK_SCALE = 0.46
# Stroke weight relative to the mark width, kept constant across both.
STROKE_RATIO = 0.096


def _gradient(size: int) -> np.ndarray:
    img = np.zeros((size, size, 3), np.uint8)
    for y in range(size):
        f = y / max(1, size - 1)
        img[y, :] = [int(TEAL_TOP[i] + (TEAL_BOTTOM[i] - TEAL_TOP[i]) * f) for i in range(3)]
    return img


def _rounded_square_mask(size: int) -> np.ndarray:
    r = int(size * 0.22)
    mask = np.zeros((size, size), np.uint8)
    cv2.rectangle(mask, (r, 0), (size - r, size), 255, -1)
    cv2.rectangle(mask, (0, r), (size, size - r), 255, -1)
    for cx, cy in ((r, r), (size - r, r), (r, size - r), (size - r, size - r)):
        cv2.circle(mask, (cx, cy), r, 255, -1)
    return mask


def _circle_mask(size: int) -> np.ndarray:
    mask = np.zeros((size, size), np.uint8)
    cv2.circle(mask, (size // 2, size // 2), size // 2, 255, -1)
    return mask


def _draw_pulse(img: np.ndarray, size: int, scale: float) -> None:
    span = size * scale
    ox = (size - span) / 2
    oy = size / 2
    pts = np.array([[ox + x * span, oy + y * span] for x, y in PULSE], np.int32)
    thickness = max(1, int(round(span * STROKE_RATIO)))
    cv2.polylines(img, [pts], False, (255, 255, 255), thickness, cv2.LINE_AA)


def _downsample(bgra: np.ndarray, target: int) -> np.ndarray:
    return cv2.resize(bgra, (target, target), interpolation=cv2.INTER_AREA)


def legacy_icon(target: int, circular: bool) -> np.ndarray:
    size = target * SUPERSAMPLE
    img = _gradient(size)
    _draw_pulse(img, size, LEGACY_MARK_SCALE)
    mask = _circle_mask(size) if circular else _rounded_square_mask(size)
    bgra = cv2.cvtColor(img, cv2.COLOR_BGR2BGRA)
    bgra[:, :, 3] = mask
    # Zero the colour outside the mask so downsampling does not bleed a halo.
    bgra[:, :, :3] = cv2.bitwise_and(bgra[:, :, :3], bgra[:, :, :3], mask=mask)
    return _downsample(bgra, target)


def adaptive_foreground(target: int) -> np.ndarray:
    """White mark on transparency, inside the adaptive safe zone."""
    size = target * SUPERSAMPLE
    layer = np.zeros((size, size, 3), np.uint8)
    _draw_pulse(layer, size, ADAPTIVE_MARK_SCALE)
    alpha = cv2.cvtColor(layer, cv2.COLOR_BGR2GRAY)
    bgra = np.zeros((size, size, 4), np.uint8)
    bgra[:, :, :3] = 255  # white mark
    bgra[:, :, 3] = alpha
    return _downsample(bgra, target)


def write_background_colour() -> None:
    path = RES / "values" / "ic_launcher_background.xml"
    path.write_text(
        '<?xml version="1.0" encoding="utf-8"?>\n'
        "<resources>\n"
        f'    <color name="ic_launcher_background">{BRAND_HEX}</color>\n'
        "</resources>\n",
        encoding="utf-8",
    )


def main() -> None:
    if not RES.exists():
        raise SystemExit(f"Android res directory not found: {RES}")

    written = []
    for bucket, (legacy_px, fg_px) in DENSITIES.items():
        folder = RES / f"mipmap-{bucket}"
        folder.mkdir(parents=True, exist_ok=True)
        targets = [
            (folder / "ic_launcher.png", legacy_icon(legacy_px, circular=False)),
            (folder / "ic_launcher_round.png", legacy_icon(legacy_px, circular=True)),
            (folder / "ic_launcher_foreground.png", adaptive_foreground(fg_px)),
        ]
        for path, image in targets:
            cv2.imwrite(str(path), image)
            written.append((path.relative_to(ROOT), image.shape[1]))

    write_background_colour()

    for rel, px in written:
        print(f"  {str(rel):<62} {px}x{px}")
    print(f"\n  adaptive background colour -> {BRAND_HEX}")
    print(f"  {len(written)} icons written")


if __name__ == "__main__":
    main()
