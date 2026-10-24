# VitalScan

A mobile-first web application that measures vital signals from a **30-second
finger-on-camera recording**. The user rests a fingertip over the rear camera
and flash; the browser extracts the per-frame optical signal and the backend
runs the rPPG pipeline defined in
[`reference/Finger_Pulse_rPPG_Analysis_New.ipynb`](reference/Finger_Pulse_rPPG_Analysis_New.ipynb).

> **Research prototype — not a medical device.** VitalScan produces experimental
> estimates for research/internship purposes only. SpO₂, perfusion index and
> respiratory rate are research-grade estimates from a standard RGB camera, not
> from a clinically calibrated pulse oximeter. Nothing here should be used for
> diagnosis or treatment decisions.

---

## What it measures

Every metric comes from the reference notebook. Nothing else is reported.

| Metric | Source in the notebook | Status |
| --- | --- | --- |
| Pulse rate — count-based | `siv_PPG_SPD` (cell 13/15) | Implemented |
| Pulse rate — PPI-based | `siv_PPG_SPD` (cell 13/15) | Implemented |
| Pulse rate — AMDF-based | `siv_AMDF_PR_SQA` (cell 13/15) | Implemented |
| Pulse rate — fused | Range/distance fusion rule (cell 16) | Implemented |
| Signal Quality Assessment | `siv_SQA` (cell 13) | Implemented |
| Rhythm regularity | `siv_Rhythm` + `siv_Rhythm_AMDF` (cell 13/20) | Implemented |
| SpO₂ | Red/blue ratio-of-ratios (cell 22) | Implemented — **experimental** |
| Perfusion index | Red-channel AC/DC (cell 22) | Implemented — **experimental** |
| Respiratory rate | Pulse-amplitude modulation (cell 24) | Implemented — **experimental** |
| rPPG waveform + detected peaks | Cells 11 + 18 | Implemented |

### Blood pressure

**Not implemented, and deliberately not present anywhere in the application.**

The repository was inspected in full: it contained exactly one file — the
reference notebook — and that notebook implements no blood-pressure algorithm.
No BP estimator was invented, no BP field exists in the API schema, and no BP
card appears in the UI. A backend test
(`test_no_blood_pressure_or_unsupported_metric_is_reported`) and a frontend test
(`never shows a blood pressure metric`) enforce this. If a real BP algorithm is
supplied later, the integration point is a new module under
`backend/app/algorithms/` plus an optional field on `MeasurementResponse`.

---

## Architecture

```
Camera (rear + torch)
   ↓  requestVideoFrameCallback, ~30 fps
Frame → 0.1× downsampled canvas → mean gray / R / G / B   (browser, notebook cell 9)
   ↓  typed arrays, no React state per frame
30 s of numeric signal  →  POST /api/measurement/process
   ↓
Uniform-grid resample  →  preprocess (cheby1 high-pass)
   ↓
Peak detection → count / PPI / AMDF pulse rates → fusion
   ↓
SQA → rhythm → SpO₂ / PI → respiratory rate
   ↓
Structured JSON  →  results + detailed analysis screens
```

**No video is uploaded or stored.** The browser sends five numbers per frame;
the server holds them in memory for the duration of one request and writes
nothing to disk.

```
Heart_Rate/
├── reference/
│   └── Finger_Pulse_rPPG_Analysis_New.ipynb   # source of truth, unmodified
├── backend/
│   ├── app/
│   │   ├── main.py                 # FastAPI app, CORS, error handling
│   │   ├── config.py               # environment-driven settings
│   │   ├── api/routes.py           # /api/health, /api/config, /api/measurement/*
│   │   ├── models/schemas.py       # typed request/response models
│   │   ├── algorithms/
│   │   │   ├── siv_core.py         # verbatim port of the notebook's siv_* functions
│   │   │   ├── rppg.py             # preprocessing, PR estimators, fusion, rhythm
│   │   │   ├── spo2.py             # SpO₂ + perfusion index
│   │   │   ├── respiration.py      # respiratory rate
│   │   │   ├── video.py            # notebook's video entry point (validation)
│   │   │   └── resample.py         # browser time-base adaptation
│   │   └── services/pipeline.py    # orchestration
│   ├── tests/                      # 48 tests, incl. notebook-parity suite
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/                  # Landing, Instructions, Measure, Processing, Results, Details
│   │   ├── components/             # waveform canvases, metric cards, status, icons
│   │   ├── hooks/                  # useCamera, useMeasurementEngine
│   │   ├── workers/                # live signal-quality analysis (off main thread)
│   │   ├── services/api.ts         # typed client with full error mapping
│   │   ├── utils/                  # frame reduction, finger detection, capabilities
│   │   └── styles/                 # design tokens + global stylesheet
│   └── package.json
└── package.json                    # root convenience scripts
```

---

## Algorithm fidelity

The port is intentionally literal. `backend/app/algorithms/siv_core.py` contains
the notebook's helper functions with identical constants, thresholds and
comparison operators. **The test suite proves this rather than asserting it:**
`backend/tests/test_notebook_parity.py` executes the function definitions
straight out of the `.ipynb` file and compares their output, element by element,
against the production modules. If a constant ever drifts, the suite fails.

Preserved verbatim, among others:

- `cheby1(5, 0.001, 0.5/(fps/2), 'high')` high-pass preprocessing
- the AMDF max-lag `round(2*(60*Fs)/30)` and its ±5-sample minimum refinement
- the `siv_SQA` threshold ladder (`-0.25`, `-0.5`, `mag > 5`, `dist > 5`)
- the fusion rule's `dist > 10` / `val in {0, 2}` logic
- the rhythm threshold `|RRI - mean| > 0.12 s` and the per-segment `|PR - ref| > 5`
- the SpO₂ calibration `SpO2 = -1.1 * R + 98`, clipped to [70, 100]
- the respiratory band `0.15–0.7 Hz`, 4 Hz resampling, 4096-point zero-padded FFT

### Documented adaptations

Three adaptations were required to run the pipeline on a live browser camera
instead of a video file. Each is documented in code at the point it happens.

1. **Mean instead of sum for the grayscale signal.** The notebook uses
   `sum(gray)` over the downsampled frame; the browser sends `mean(gray)`. The
   next two notebook steps are `d - mean(d)` then division by `max|d - mean(d)|`,
   so a constant pixel-count factor cancels exactly. `test_preprocess_is_scale_invariant`
   pins this equivalence down. Keeping values in 0–255 also lets the API validate
   them as intensities.
2. **Uniform-grid resampling** (`algorithms/resample.py`). A video file has one
   constant frame rate; a browser camera stream jitters and drops frames. Each
   sample is timestamped with its media time and linearly resampled onto a
   uniform grid at the measured effective rate, so the pipeline receives exactly
   the input shape it expects. For a uniform capture this is a no-op.
3. **Capture duration.** The notebook analyses 60 s after trimming 5 s
   (`DISCARD_SEC`/`DURATION_SEC`). The app targets a 30 s capture, preceded by a
   finger-placement and signal-check stage that plays the role of the trim — the
   measurement only starts once the camera's exposure has settled and a steady
   pulsatile signal is present. `siv_Rhythm_AMDF` already stops when a segment
   would run past the end of the signal, so 30 s simply yields three 10-second
   segments instead of six; its per-segment logic is untouched. Both are
   configurable (`VITALSCAN_MEASUREMENT_SECONDS`).

The grayscale conversion uses the same BT.601 weights as `cv2.COLOR_BGR2GRAY`,
and the browser downsamples by the notebook's `RESIZE_FACTOR = 0.1`.

---

## Setup

Requires **Python 3.10+** and **Node 20+**.

### Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

### Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
```

---

## Running locally

Two terminals:

```bash
cd backend && python -m uvicorn app.main:app --reload --port 8000
```

```bash
cd frontend && npm run dev
```

Or, with the backend virtualenv activated, from the repository root:

```bash
npm run install:all && npm run dev:all
```

The app is then at <http://localhost:5173> and the API docs at
<http://localhost:8000/docs>.

---

## Environment variables

### Frontend (`frontend/.env.local`)

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_API_BASE_URL` | Base URL of the API, no trailing slash | `http://localhost:8000` |
| `VITE_API_TIMEOUT_MS` | Analysis request timeout | `45000` |
| `VITE_MEASUREMENT_SECONDS` | Target capture duration | `30` |

### Backend (`backend/.env`)

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITALSCAN_CORS_ORIGINS` | Comma-separated allowed origins | localhost:5173 |
| `VITALSCAN_MEASUREMENT_SECONDS` | Duration advertised to the client | `30` |
| `VITALSCAN_MIN_ANALYSIS_SECONDS` | Shortest analysable signal | `20` |
| `VITALSCAN_MAX_SAMPLES` | Per-request sample cap | `20000` |
| `VITALSCAN_ENABLE_VIDEO_ENDPOINT` | Enable the video validation endpoint | `true` |
| `VITALSCAN_MAX_VIDEO_BYTES` | Upload limit for that endpoint | `80 MiB` |
| `VITALSCAN_VIDEO_DISCARD_SECONDS` | Notebook `DISCARD_SEC` (video path only) | `5` |
| `VITALSCAN_VIDEO_DURATION_SECONDS` | Notebook `DURATION_SEC` (video path only) | `60` |

No secrets are required, and none are committed. `.env` files are gitignored;
only `.env.example` is tracked.

---

## Testing on a phone

Browsers only grant camera access in a **secure context**: HTTPS, or
`localhost`. A plain `http://192.168.x.x:5173` will not work. Options:

1. **Tunnel (simplest).** Run `npx localtunnel --port 5173` (or `ngrok http 5173`)
   and open the HTTPS URL on the phone. Point `VITE_API_BASE_URL` at a tunnel for
   the backend too, and add that origin to `VITALSCAN_CORS_ORIGINS`.
2. **Local HTTPS.** Generate a certificate with `mkcert`, serve Vite over HTTPS
   (`server.https` in `vite.config.ts`), and trust the certificate on the phone.
3. **Chrome flag (Android, development only).** `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
   add `http://<your-ip>:5173`.

Torch (flashlight) control is available through `MediaStreamTrack.applyConstraints`
on Chromium-based Android browsers. It is **not** available on iOS Safari or on
most desktop browsers; VitalScan detects this at runtime and falls back to asking
the user to switch the flashlight on manually. The measurement works either way.

---

## API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/health` | Liveness + whether the video endpoint is available |
| `GET /api/config` | Measurement duration, limits, supported metrics |
| `POST /api/measurement/process` | Analyse per-frame signals from the browser |
| `POST /api/measurement/process-video` | Developer tool: run the pipeline on a finger video |

Request (`/api/measurement/process`):

```json
{
  "signals": {
    "timestamps": [0.0, 0.033, "..."],
    "gray": [99.2, 99.6, "..."],
    "red":  [205.1, 206.0, "..."],
    "green":[57.9, 58.1, "..."],
    "blue": [34.8, 35.0, "..."]
  },
  "meta": { "torch_enabled": true, "facing_mode": "environment" }
}
```

Response (abridged; a metric the pipeline could not produce is `null`, never a
placeholder number):

```json
{
  "status": "success",
  "pulse_rate": { "count_based": 74, "ppi_based": 74, "amdf_based": 75,
                  "fused": 74, "unit": "bpm", "peaks_detected": 37 },
  "signal_quality": { "sqa_flag": 0, "label": "Good",
                      "method_spread_bpm": 1, "good_segments": 3, "total_segments": 3 },
  "rhythm": { "ppi_method": "Regular", "amdf_method": "Regular",
              "segment_pulse_rates": [75, 75, 75], "segment_quality": [0, 0, 0] },
  "spo2": { "value": 96.6, "unit": "%", "experimental": true,
            "ratio_of_ratios": 1.2294, "calibration": "SpO2 = -1.1 * R + 98.0" },
  "perfusion_index": { "value": 0.67, "unit": "%", "experimental": true },
  "respiratory_rate": { "value": 16.0, "unit": "breaths/min", "experimental": true },
  "waveform": { "rppg": ["..."], "raw": ["..."], "peak_indices": ["..."] },
  "amdf": { "curve": ["..."], "minima_indices": [40] },
  "notes": []
}
```

`fused` is `null` when the notebook's fusion rule is inconclusive; the UI then
shows the AMDF estimate and says why, rather than inventing a fused value.

### Validating against the notebook's own video

The notebook was run against `Asit_1.mp4` (478×850, 30 fps, ~71 s), which is not
in this repository. To reproduce its numbers with your copy of that clip:

```bash
curl -F "file=@Asit_1.mp4" http://localhost:8000/api/measurement/process-video
```

With the default `DISCARD_SEC=5` / `DURATION_SEC=60` this runs exactly the
notebook's path. The notebook's recorded output for that clip was 102 / 102 /
100 bpm, fused 101, quality Good, SpO₂ 98.0 %, PI 0.55 %, RR 23.4 breaths/min.

---

## Performance

- Frames are reduced to five numbers in `requestVideoFrameCallback` and written
  into growable `Float64Array` buffers held in refs — **no React state updates
  per frame**.
- React state is published on a 5 Hz heartbeat with only the values the UI shows.
- The live waveform runs its own `requestAnimationFrame` canvas loop reading the
  buffers directly; it never re-renders the component tree.
- The rolling cardiac-band analysis used for finger detection runs in a **Web
  Worker**.
- Preview memory is capped (`trimTo`) so idling on the placement screen does not
  grow without bound.
- If `requestVideoFrameCallback` is unavailable — or is present but never fires,
  as in some embedded browsers — an 800 ms watchdog falls back to
  `requestAnimationFrame` sampling. If frames stop arriving entirely, the app
  says so after 8 s instead of hanging.
- Result waveforms are decimated to ≤1800 points before transport.

Production bundle: ~309 kB JS (≈97 kB gzipped) plus ~14 kB CSS.

---

## Accessibility

Semantic buttons and headings, visible focus rings, ARIA labels on the camera
preview and progress bar, `aria-live` status updates for placement and signal
state, canvas charts with descriptive `role="img"` labels, and a skip link.
Status is never conveyed by colour alone — each signal-quality tone carries a
distinct glyph and an explicit text label. `prefers-reduced-motion` disables all
animation, and `prefers-color-scheme` is supported in both directions.

## Privacy

- The camera stream never leaves the device; only per-frame brightness and
  colour numbers are transmitted.
- Results live in React state only — no `localStorage`, no `sessionStorage`, no
  cookies. Reloading the tab discards them.
- The service worker precaches the app shell only; API responses and measurement
  data are never cached.
- The camera and torch are released as soon as the capture finishes.
- Uploads to the developer video endpoint are streamed to a temporary file and
  deleted in a `finally` block; raw video is never logged or persisted.

## Security

- CORS is restricted to configured origins (no wildcard default).
- All request bodies are validated by typed Pydantic models: array lengths must
  match, values must be 0–255 intensities, and sample counts are capped.
- Upload size is capped and file extensions are allow-listed.
- Python tracebacks never reach the client; a global exception handler returns a
  generic message and logs the detail server-side.
- No secrets, keys or deployment URLs are hard-coded.

---

## Tests

```bash
cd backend && python -m pytest        # 48 tests
cd frontend && npm run test           # 89 tests
cd frontend && npm run build          # type-check + production build
```

**Backend (48)**

- `test_notebook_parity.py` — executes the notebook's own function definitions
  and asserts element-wise equality with the production port, plus guards on the
  SpO₂ calibration and respiratory-band constants.
- `test_pipeline.py` — pulse rate tracked across 52–120 bpm, respiratory rate
  recovered, experimental flags, honest failure on short/flat/noise input,
  segment adaptation for a 30 s capture, resampling behaviour, and a scope guard
  asserting no blood-pressure or other unsupported metric can appear.
- `test_api.py` — contract, validation (mismatched arrays, out-of-range
  intensities, too-short capture), error shapes, and no traceback leakage.
- `test_video_path.py` — renders a synthetic finger video, decodes it through the
  notebook's `ExtractVideo` path and recovers the rendered pulse rate.

**Frontend (89)**

- `useMeasurementEngine.test.tsx` — drives the whole state machine against a fake
  camera: placement detection, torch fallback, countdown → capture → handover,
  media-clock timestamps, abort on finger loss, and the no-frames error path.
- `frameStats`, `fingerDetect`, `signalQuality.worker` — unit coverage of frame
  reduction, buffers, placement classification and the cardiac-band analysis.
- `api.test.ts` — every failure mode (400/413/422/500, network, timeout,
  malformed and incomplete responses).
- Page tests — landing, instructions, camera-permission errors, processing
  stages, results rendering, unavailable metrics, and the BP scope guard.

---

## Android app (offline APK)

The Android build runs the **entire rPPG pipeline on the device**, so the app
works with no internet connection at all — no backend, no API calls.

```bash
cd frontend
npm run sync:android                    # build web assets in local mode + copy into the Android project
cd android
JAVA_HOME="/c/Program Files/Android/Android Studio/jbr" ./gradlew assembleDebug
# -> app/build/outputs/apk/debug/app-debug.apk   (~4.2 MB)
```

Use the JDK that ships with Android Studio (21). A newer system JDK such as 22
is not supported by the Android Gradle Plugin. Opening `frontend/android` in
Android Studio and pressing Run selects the right JDK automatically.

Install by copying the APK to the phone and opening it (Android will ask you to
allow installs from that source), or `adb install -r app-debug.apk`.

### Why the algorithm is duplicated

The pipeline exists twice on purpose:

| Build | Processing | Selected by |
| --- | --- | --- |
| Web (Vercel) | POST to the FastAPI backend on Render | default |
| Android (APK) | `src/algorithms/` on the device | `.env.android` → `VITE_PROCESSING_MODE=local` |

`src/services/processor.ts` picks the strategy; both return the identical
`Measurement` shape, so every screen is unchanged. The web bundle code-splits
the algorithm into a separate chunk it never loads.

### Keeping the two implementations honest

The TypeScript port is not a re-derivation — it is checked against Python:

- **Filter design is not reimplemented.** `cheby1` and `butter` depend only on
  `fps`, so `backend/tools/export_js_reference.py` emits SciPy's own `b`/`a`
  coefficients for every supported rate (5–60 fps) into
  `src/algorithms/filterCoefficients.ts`. Only `filtfilt` is genuinely ported.
- **Every stage is asserted element-wise** against fixtures generated by the
  real Python pipeline (`src/algorithms/parity.test.ts`), to < 1e-9: preprocessing,
  peak indices, PPI, AMDF curve and minima, all three pulse-rate estimates, the
  fusion rule, SQA, both rhythm methods, SpO₂, PI and RR.
- Because the Python pipeline is itself verified against the notebook by
  `backend/tests/test_notebook_parity.py`, the chain ties the on-device code
  back to `reference/Finger_Pulse_rPPG_Analysis_New.ipynb`.

Two details that would otherwise cause silent drift and are handled explicitly:
Python's `round()` is round-half-to-even while JavaScript's `Math.round` is not
(`pyRound` in `numeric.ts`), and `moving_avg_fil` computes a guard value of
`3*(N-1)` but then falls through to SciPy's *default* `padlen` of `3*N`.

Regenerate the coefficients and fixtures after any algorithm change:

```bash
cd backend && python tools/export_js_reference.py
```

### Launcher icons

The icons are generated, not hand-exported, so they stay in sync with the brand
colours in `frontend/src/styles/tokens.css`:

```bash
cd backend && .venv/Scripts/python tools/generate_launcher_icons.py
```

This writes all three sets Android expects across five density buckets -
legacy square, legacy round, and the adaptive-icon foreground - plus the
adaptive background colour.

The adaptive foreground is sized for the **safe zone**: of the 108dp canvas,
only the central 66dp is guaranteed to survive the launcher's mask, which
varies by device (circle, squircle, rounded square, teardrop). The mark's
*stroked* bounding box - not just its path - is kept inside that, spanning
roughly 0.25-0.75 of the canvas. The brand teal is supplied separately as the
adaptive background so the launcher's parallax effect works correctly.

### Known limitations

- The APK is **debug-signed**. Fine for sideloading; a release keystore is
  needed for Play Store distribution.
- SpO₂ and PI require ≥ 9 fps: below that the cardiac band's 4 Hz edge reaches
  Nyquist and no filter design exists. The on-device build reports them as
  unavailable, exactly as the backend does.

## Deployment

The frontend is a static bundle; the backend is a standard ASGI app.

**Frontend** (Vercel / Netlify / Cloudflare Pages): build command
`npm run build`, output `frontend/dist`, and set `VITE_API_BASE_URL` to the
deployed API origin. Configure an SPA rewrite so client routes resolve to
`index.html`.

**Backend** (Render / Railway / Fly.io / any container host):

```bash
pip install -r backend/requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port $PORT   # run from backend/
```

Set `VITALSCAN_CORS_ORIGINS` to the deployed frontend origin and consider
`VITALSCAN_ENABLE_VIDEO_ENDPOINT=false` in production.

**HTTPS is mandatory.** Mobile browsers refuse `getUserMedia` outside a secure
context, so the deployed site must be served over TLS.

VitalScan is installable as a PWA (manifest, icons, standalone display) and works
as an ordinary website when installation is unavailable.

---

## Limitations

- **Not a medical device.** SpO₂, PI and RR are experimental. SpO₂ in particular
  uses generic calibration constants against a red/blue camera ratio rather than
  a calibrated red/infrared oximeter; treat the absolute value as indicative at
  best.
- **No calibration data.** The notebook's reference video (`Asit_1.mp4`) is not
  in the repository, so end-to-end numerical parity against the notebook's own
  recorded results could not be executed here. Parity is instead enforced at the
  function level against the notebook's own code, and the video path is verified
  against a synthetic clip with a known pulse rate.
- **Torch control** is unavailable on iOS Safari and most desktop browsers; the
  manual-flashlight fallback is used there.
- **Finger-placement detection is a precondition check, not a measurement.** It
  uses brightness, redness, spatial uniformity, frame-to-frame motion and
  cardiac-band pulsatility measured from real frames to decide whether recording
  is worthwhile. It does not claim to identify what is in front of the lens.
- **Signal quality is the notebook's binary `siv_SQA` verdict** (Good/Bad). The
  UI reports that verdict plus the factual evidence behind it (good segments,
  method spread, peak count). No invented probability score is shown, because the
  notebook does not produce one.
