/**
 * Pipeline stages: preprocessing, pulse rate + fusion, rhythm, SpO2/PI and
 * respiratory rate.
 *
 * Ports `backend/app/algorithms/{rppg,spo2,respiration,resample}.py`, which
 * carry the notebook's cells 11, 15, 16, 20, 22 and 24. Constants and
 * calibration are preserved exactly; see the Python modules for provenance.
 */

import {
  CARDIAC_BANDPASS_BY_FPS,
  CARDIAC_MIN_FPS,
  HIGHPASS_BY_FPS,
  RESPIRATORY_BANDPASS,
} from './filterCoefficients';
import { filtfilt } from './filtfilt';
import {
  arange,
  argMin,
  clip,
  detrend,
  interp,
  maxAbs,
  mean,
  pyRound,
  rfftFreq,
  rfftPowerSpectrum,
  std,
} from './numeric';
import { amdfPrSqa, ppgSpd, rhythm, rhythmAmdf } from './sivCore';

// ---------------------------------------------------------------- constants
/** Notebook cell 22 calibration. Replace only with a real oximeter calibration. */
export const SPO2_SLOPE = -1.1;
export const SPO2_INTERCEPT = 98.0;

/** Notebook cell 24 - 9 to 42 breaths/min, 4 Hz resample grid, 4096-point FFT. */
export const RR_BAND_LOW_HZ = 0.15;
export const RR_BAND_HIGH_HZ = 0.7;
export const RR_RESAMPLE_HZ = 4.0;
const RR_NFFT = 4096;

export class PipelineError extends Error {}

// ------------------------------------------------------------- preprocessing
export interface PreprocessedSignal {
  dA: Float64Array;
  x: Float64Array;
}

/** Notebook cell 11: `d -> d_m -> d_a -> cheby1 high-pass -> x`. */
export function preprocess(dGray: ArrayLike<number>, fps: number): PreprocessedSignal {
  const m = mean(dGray);
  const dM = new Float64Array(dGray.length);
  for (let i = 0; i < dGray.length; i += 1) dM[i] = dGray[i] - m;

  const peak = maxAbs(dM);
  if (peak === 0) {
    throw new PipelineError(
      'Frame-intensity signal is constant - no optical variation captured.',
    );
  }
  const dA = new Float64Array(dM.length);
  for (let i = 0; i < dM.length; i += 1) dA[i] = dM[i] / peak;

  const coeffs = HIGHPASS_BY_FPS[fps];
  if (!coeffs) {
    throw new PipelineError(`No filter design available for ${fps} fps.`);
  }
  const filtered = filtfilt(coeffs.b, coeffs.a, dA);
  const xPeak = maxAbs(filtered);
  if (xPeak === 0) {
    throw new PipelineError('Filtered rPPG signal is empty - no pulsatile content captured.');
  }
  const x = new Float64Array(filtered.length);
  for (let i = 0; i < filtered.length; i += 1) x[i] = filtered[i] / xPeak;

  return { dA, x };
}

// ----------------------------------------------------------- pulse rate
export interface PulseRateResult {
  prCount: number;
  prPpi: number;
  prAmdf: number;
  fused: number | null;
  sqaFlag: number;
  peaks: number[];
  ppi: Float64Array;
  ySmooth: Float64Array;
  amdfCurve: Float64Array;
  amdfLocs: number[];
}

/** Notebook cell 16 - the MATLAB script's range/dist fusion rule. */
function fuse(prCount: number, prPpi: number, prAmdf: number): number | null {
  const rng = [prAmdf, prCount, prPpi, prAmdf];
  let val = 0;
  for (let i = 1; i < rng.length; i += 1) {
    if (rng[i] - rng[i - 1] > 10) val += 1;
  }
  if (val === 0 || val === 2) return pyRound((prCount + prPpi + prAmdf) / 3);
  return null; // "Signal Quality is Bad (fusion inconclusive)"
}

/** Notebook cells 15 + 16. */
export function pulseRate(x: ArrayLike<number>, fps: number, durationS: number): PulseRateResult {
  const spd = ppgSpd(x, fps, durationS);
  const am = amdfPrSqa(x, fps);
  return {
    prCount: spd.pr1,
    prPpi: spd.pr2,
    prAmdf: am.pr,
    fused: fuse(spd.pr1, spd.pr2, am.pr),
    sqaFlag: am.sq,
    peaks: spd.sp,
    ppi: spd.ppi,
    ySmooth: spd.ySmooth,
    amdfCurve: am.curve,
    amdfLocs: am.locs,
  };
}

// --------------------------------------------------------------- rhythm
export interface RhythmResult {
  ppiRegular: boolean;
  amdfRegular: boolean;
  segmentPr: number[];
  segmentSqa: number[];
}

/** Notebook cell 20. */
export function assessRhythm(
  x: ArrayLike<number>,
  fps: number,
  ppi: ArrayLike<number>,
  refPr: number,
): RhythmResult {
  const rh = rhythm(ppi);
  const seg = rhythmAmdf(x, fps, refPr);
  return {
    ppiRegular: rh === 1,
    amdfRegular: seg.flag === 1,
    segmentPr: seg.segmentPr,
    segmentSqa: seg.segmentSqa,
  };
}

// ------------------------------------------------------------- SpO2 / PI
export interface SpO2Result {
  spo2: number;
  perfusionIndex: number;
  ratioOfRatios: number;
  acRed: number;
  dcRed: number;
  acBlue: number;
  dcBlue: number;
}

function acDc(channel: ArrayLike<number>, fps: number): { ac: number; dc: number } {
  const dc = mean(channel);
  const coeffs = CARDIAC_BANDPASS_BY_FPS[fps];
  if (!coeffs) {
    throw new PipelineError(
      `The cardiac band (0.7-4.0 Hz) has no valid design below ${CARDIAC_MIN_FPS} fps.`,
    );
  }
  const ac = std(filtfilt(coeffs.b, coeffs.a, channel));
  return { ac, dc };
}

/** Notebook cell 22 - red/blue ratio-of-ratios. EXPERIMENTAL. */
export function estimateSpo2Pi(
  dRed: ArrayLike<number>,
  dBlue: ArrayLike<number>,
  fps: number,
): SpO2Result {
  const red = acDc(dRed, fps);
  const blue = acDc(dBlue, fps);

  if (red.dc === 0 || blue.dc === 0 || blue.ac === 0) {
    throw new PipelineError('Red/blue channel signal has no usable DC or AC component.');
  }

  const ratio = red.ac / red.dc / (blue.ac / blue.dc);
  return {
    spo2: clip(SPO2_SLOPE * ratio + SPO2_INTERCEPT, 70, 100),
    perfusionIndex: (red.ac / red.dc) * 100,
    ratioOfRatios: ratio,
    acRed: red.ac,
    dcRed: red.dc,
    acBlue: blue.ac,
    dcBlue: blue.dc,
  };
}

// -------------------------------------------------------- respiratory rate
/** Notebook cell 24. Returns breaths/min, or `null` when not estimable. */
export function estimateRr(
  spIdx: number[],
  fs: number,
  ySignal: ArrayLike<number>,
): number | null {
  if (spIdx.length < 4) return null;

  const peakTimes = spIdx.map((i) => i / fs);
  const peakAmps = spIdx.map((i) => ySignal[i]);

  const fsU = RR_RESAMPLE_HZ;
  const tUniform = arange(peakTimes[0], peakTimes[peakTimes.length - 1], 1 / fsU);
  if (tUniform.length < 16) return null;

  const ampInterp = detrend(interp(tUniform, peakTimes, peakAmps));

  const ny = fsU / 2;
  const lo = RR_BAND_LOW_HZ;
  const hi = Math.min(RR_BAND_HIGH_HZ, ny * 0.95);
  const resp = filtfilt(RESPIRATORY_BANDPASS.b, RESPIRATORY_BANDPASS.a, ampInterp);

  const freqs = rfftFreq(RR_NFFT, 1 / fsU);
  const spectrum = rfftPowerSpectrum(resp, RR_NFFT);

  let bestIdx = -1;
  let bestPower = -Infinity;
  for (let i = 0; i < freqs.length; i += 1) {
    if (freqs[i] < lo || freqs[i] > hi) continue;
    if (spectrum[i] > bestPower) {
      bestPower = spectrum[i];
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  return freqs[bestIdx] * 60;
}

// ------------------------------------------------------- uniform resampling
export interface UniformSignals {
  gray: Float64Array;
  red: Float64Array;
  green: Float64Array;
  blue: Float64Array;
  fps: number;
  durationS: number;
  effectiveFps: number;
  droppedSamples: number;
  jitterMs: number;
}

/**
 * Port of `resample.to_uniform_grid`. A browser camera stream jitters and drops
 * frames; the notebook assumes a constant rate, so samples are mapped onto a
 * uniform grid at the measured effective rate.
 */
export function toUniformGrid(
  timestamps: ArrayLike<number>,
  gray: ArrayLike<number>,
  red: ArrayLike<number>,
  green: ArrayLike<number>,
  blue: ArrayLike<number>,
): UniformSignals {
  const n = timestamps.length;
  if (n < 2) throw new PipelineError('At least two frame samples are required.');
  for (const c of [gray, red, green, blue]) {
    if (c.length !== n) {
      throw new PipelineError('Timestamp and channel arrays must have the same length.');
    }
  }

  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => timestamps[a] - timestamps[b]);
  const t: number[] = [];
  const ch: number[][] = [[], [], [], []];
  const sources = [gray, red, green, blue];
  let dropped = 0;

  for (const idx of order) {
    const value = timestamps[idx];
    if (!Number.isFinite(value)) throw new PipelineError('Frame samples contain non-finite values.');
    if (t.length > 0 && value - t[t.length - 1] <= 1e-9) {
      dropped += 1;
      continue;
    }
    t.push(value);
    for (let c = 0; c < 4; c += 1) ch[c].push(sources[c][idx]);
  }

  if (t.length < 2) {
    throw new PipelineError('At least two distinctly-timed frame samples are required.');
  }

  const base = t[0];
  for (let i = 0; i < t.length; i += 1) t[i] -= base;
  const duration = t[t.length - 1];
  if (duration <= 0) throw new PipelineError('Capture duration must be positive.');

  const effectiveFps = (t.length - 1) / duration;
  const fps = pyRound(effectiveFps);
  if (fps < 5) {
    throw new PipelineError(
      `Effective capture rate ${effectiveFps.toFixed(1)} fps is too low for pulse analysis.`,
    );
  }

  const count = Math.floor(duration * fps) + 1;
  const grid = new Float64Array(count);
  for (let i = 0; i < count; i += 1) grid[i] = i / fps;

  const intervals: number[] = [];
  for (let i = 1; i < t.length; i += 1) intervals.push(t[i] - t[i - 1]);

  return {
    gray: interp(grid, t, ch[0]),
    red: interp(grid, t, ch[1]),
    green: interp(grid, t, ch[2]),
    blue: interp(grid, t, ch[3]),
    fps,
    durationS: grid[count - 1],
    effectiveFps,
    droppedSamples: dropped,
    jitterMs: std(intervals) * 1000,
  };
}

export { argMin };
