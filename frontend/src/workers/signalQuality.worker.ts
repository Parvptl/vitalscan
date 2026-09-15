/**
 * Live signal-quality worker.
 *
 * Runs the rolling cardiac-band analysis used for the finger-placement /
 * signal-check stage so it never competes with the camera loop on the main
 * thread. It answers one question: "is the camera currently receiving a
 * plausible pulsatile signal?"
 *
 * This is a PREVIEW check only. It does not produce any reported measurement -
 * every value shown on the results screen comes from the backend's
 * notebook-derived pipeline.
 */

export interface QualityRequest {
  /** Rolling window of mean grayscale samples (oldest first). */
  samples: Float64Array;
  /** Effective sample rate of that window, in Hz. */
  fps: number;
}

export interface QualityResponse {
  /** AC/DC pulsatility inside the cardiac band, as a percentage. */
  perfusionPct: number;
  /** Share of total in-window power that falls inside the cardiac band. */
  bandPowerRatio: number;
  /** Dominant in-band frequency, Hz (indicative only - not a reported rate). */
  dominantHz: number;
}

/** Cardiac band, matching the notebook's SpO2 AC extraction: 0.7-4.0 Hz. */
const BAND_LOW_HZ = 0.7;
const BAND_HIGH_HZ = 4.0;

function linearDetrend(x: Float64Array): Float64Array {
  const n = x.length;
  if (n < 2) return x.slice();
  let sx = 0;
  let sy = 0;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i += 1) {
    sx += i;
    sy += x[i];
    sxy += i * x[i];
    sxx += i * i;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom === 0 ? 0 : (n * sxy - sx * sy) / denom;
  const intercept = (sy - slope * sx) / n;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = x[i] - (slope * i + intercept);
  return out;
}

/**
 * Real DFT power spectrum over the bins we care about.
 *
 * The window is short (a few seconds at ~30 fps) and this runs a handful of
 * times per second in a worker, so a direct evaluation of the in-band bins is
 * both simpler and fast enough.
 */
export function analyseWindow(samples: Float64Array, fps: number): QualityResponse {
  const n = samples.length;
  const empty: QualityResponse = { perfusionPct: 0, bandPowerRatio: 0, dominantHz: 0 };
  if (n < 16 || !Number.isFinite(fps) || fps <= 0) return empty;

  let dc = 0;
  for (let i = 0; i < n; i += 1) dc += samples[i];
  dc /= n;
  if (dc <= 0) return empty;

  const detrended = linearDetrend(samples);

  // Hann window to limit spectral leakage from the finite record.
  const windowed = new Float64Array(n);
  let windowPower = 0;
  for (let i = 0; i < n; i += 1) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    windowed[i] = detrended[i] * w;
    windowPower += windowed[i] * windowed[i];
  }
  if (windowPower <= 0) return empty;

  const maxBin = Math.floor(n / 2);
  let totalPower = 0;
  let bandPower = 0;
  let peakPower = 0;
  let peakHz = 0;

  for (let k = 1; k <= maxBin; k += 1) {
    const hz = (k * fps) / n;
    let re = 0;
    let im = 0;
    const step = (2 * Math.PI * k) / n;
    for (let i = 0; i < n; i += 1) {
      const angle = step * i;
      re += windowed[i] * Math.cos(angle);
      im -= windowed[i] * Math.sin(angle);
    }
    const power = re * re + im * im;
    totalPower += power;
    if (hz >= BAND_LOW_HZ && hz <= BAND_HIGH_HZ) {
      bandPower += power;
      if (power > peakPower) {
        peakPower = power;
        peakHz = hz;
      }
    }
  }

  if (totalPower <= 0) return empty;

  // AC amplitude of the band-limited content, via Parseval on the in-band bins,
  // corrected for the Hann window's coherent gain.
  const acRms = Math.sqrt((2 * bandPower) / (n * n)) / 0.5;
  const perfusionPct = (acRms / dc) * 100;

  return {
    perfusionPct,
    bandPowerRatio: bandPower / totalPower,
    dominantHz: peakHz,
  };
}

self.onmessage = (event: MessageEvent<QualityRequest>) => {
  const { samples, fps } = event.data;
  const result = analyseWindow(samples, fps);
  (self as unknown as Worker).postMessage(result);
};
