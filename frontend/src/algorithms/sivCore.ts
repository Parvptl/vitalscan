/**
 * TypeScript port of `backend/app/algorithms/siv_core.py`, which is itself a
 * verbatim port of the `siv_*` helpers in
 * `reference/Finger_Pulse_rPPG_Analysis_New.ipynb`.
 *
 * Every constant, threshold and comparison operator is preserved. The Python
 * module is the reference; `parity.test.ts` asserts this file reproduces its
 * output stage by stage.
 */

import { filtfilt } from './filtfilt';
import { argMin, diff, gradient, maxAbs, mean, pyRound } from './numeric';

/** `siv_moving_avg_fil.m` - zero-phase moving-average (box) filter. */
export function movingAvgFil(x: ArrayLike<number>, n: number): Float64Array {
  const N = Math.trunc(n);
  const b = new Array<number>(N).fill(1 / N);
  const a = [1.0];
  // The Python guard uses 3*(max(len(a), len(b)) - 1); when the input is long
  // enough it falls through to filtfilt's *default* padlen of 3*max(...),
  // which is a different value. Both branches are reproduced exactly.
  const guard = 3 * (Math.max(a.length, b.length) - 1);
  if (x.length <= guard) {
    return filtfilt(b, a, x, Math.max(0, x.length - 2));
  }
  return filtfilt(b, a, x);
}

/** `siv_th_cross.m` - generic threshold crossing. */
export function thCross(x: ArrayLike<number>, m: string, th: number): number[] {
  const n = x.length;
  const out: number[] = [];
  for (let i = 1; i < n; i += 1) {
    const prev = x[i - 1] >= th ? 1 : 0;
    const cur = x[i] >= th ? 1 : 0;
    const k = cur - prev;
    if (m.includes('p')) {
      if (k > 0) out.push(i - 1);
    } else if (m.includes('n')) {
      if (k < 0) out.push(i - 1);
    } else if (k !== 0) {
      out.push(i - 1);
    }
  }
  return out;
}

/**
 * `siv_neg_th_cross.m` - negative-going threshold crossing with a one-sample
 * refinement. Used to locate systolic peaks.
 */
export function negThCross(ydif: ArrayLike<number>, th: number): number[] {
  const L = ydif.length;
  const out: number[] = [];
  for (let i = 0; i < L - 3; i += 1) {
    if (ydif[i] > th && ydif[i + 1] <= th) {
      if (Math.abs(ydif[i + 1]) > Math.abs(ydif[i + 2])) out.push(i + 2);
      else out.push(i + 1);
    }
  }
  return out;
}

/** `siv_peakanno_AMDF.m` - locate the first prominent peak of `ym`. */
export function peakannoAmdf(ym: ArrayLike<number>): number[] {
  let ydif = gradient(ym);
  ydif = movingAvgFil(ydif, 3);
  if (ydif.length >= 10) {
    const fill = ydif[9];
    for (let i = 0; i < 10; i += 1) ydif[i] = fill;
  }
  let mx = maxAbs(ydif);
  if (mx === 0) mx = 1.0;
  const scaled = new Float64Array(ydif.length);
  for (let i = 0; i < ydif.length; i += 1) scaled[i] = ydif[i] / mx;

  const zerocross = negThCross(scaled, -0.1);
  if (zerocross.length < 2) return [0, 0]; // fallback for the no-peak edge case
  return zerocross;
}

/**
 * `siv_AMDF_04.m` - Average Magnitude Difference Function.
 * `D[i]` corresponds to lag `i + 1`.
 */
export function amdf(x: ArrayLike<number>, maxLagIn?: number): Float64Array {
  const N = x.length;
  let maxLag = maxLagIn ?? N - 1;
  maxLag = Math.min(maxLag, N - 1);
  if (maxLag < 0) maxLag = 0;

  const D = new Float64Array(maxLag);
  for (let k = 1; k <= maxLag; k += 1) {
    let acc = 0;
    const count = N - k;
    for (let i = 0; i < count; i += 1) acc += Math.abs(x[i] - x[i + k]);
    D[k - 1] = acc / count;
  }
  return D;
}

/** `siv_SQA.m` - signal-quality assessment. Returns 0 = good, 1 = bad. */
export function sqa(
  x: ArrayLike<number>,
  AMDF: ArrayLike<number>,
  locs2: number[],
  PR: number,
): number {
  const th = 0.1;
  const thm = -0.1;
  const crossTh = thCross(x, 'b', th);
  const crossThm = thCross(x, 'b', thm);

  let N = locs2.length;
  if (locs2[0] === 0 || (locs2.length > 1 && locs2[1] === 0)) N = 0;

  const mag = Math.abs(crossTh.length - crossThm.length);

  if (N < 2 || PR < 30 || PR > 300) return 1;
  if (AMDF[locs2[0]] > -0.25 && AMDF[locs2[1]] > -0.25 && mag > 5) return 1;
  if (AMDF[locs2[0]] < -0.5 && AMDF[locs2[1]] < -0.5 && mag <= 5) return 0;

  const rng = [0, ...locs2];
  const distance = diff(rng);
  const dist = diff(distance);
  let SQ = 0;
  for (let i = 0; i < dist.length; i += 1) {
    SQ = dist[i] > 5 ? 1 : 0;
    if (SQ === 1) break;
  }
  return SQ;
}

export interface AmdfPrSqaResult {
  pr: number;
  sq: number;
  curve: Float64Array;
  locs: number[];
}

/** `siv_AMDF_PR_SQA.m` - pulse rate + SQA from the AMDF's first minimum. */
export function amdfPrSqa(x: ArrayLike<number>, Fs: number): AmdfPrSqaResult {
  const amdfH = pyRound((2 * (60 * Fs)) / 30);
  const amdfO = amdf(x, amdfH);
  const A = amdfO.slice(0, amdfH);

  const m = mean(A);
  for (let i = 0; i < A.length; i += 1) A[i] -= m;
  let famp = maxAbs(A);
  if (famp === 0) famp = 1.0;
  for (let i = 0; i < A.length; i += 1) A[i] /= famp;

  const locs2 = [...peakannoAmdf(negate(A))];
  if (locs2[0] > 5 && locs2[0] <= amdfH - 5) {
    const lo = locs2[0] - 5;
    const hi = locs2[0] + 6;
    const ref = argMin(A.slice(lo, hi));
    locs2[0] = lo + ref;
  }

  const lag = locs2[0] + 1;
  const pr = lag > 0 ? Math.floor((60 * Fs) / lag) : 0;
  const sq = sqa(x, A, locs2, pr);

  return { pr, sq, curve: A, locs: locs2 };
}

function negate(x: ArrayLike<number>): Float64Array {
  const out = new Float64Array(x.length);
  for (let i = 0; i < x.length; i += 1) out[i] = -x[i];
  return out;
}

export interface PpgSpdResult {
  pr1: number;
  pr2: number;
  sp: number[];
  ppi: Float64Array;
  ySmooth: Float64Array;
  xd: Float64Array;
}

/** `siv_PPG_SPD.m` - systolic-peak detection + count/PPI-based pulse rate. */
export function ppgSpd(y: ArrayLike<number>, Fs: number, t: number): PpgSpdResult {
  const order = Math.max(Math.trunc(Math.ceil(0.1 * Fs)), 1);
  const ySmooth = movingAvgFil(y, order);
  let xd = gradient(ySmooth);
  xd = movingAvgFil(xd, order);
  let mx = maxAbs(xd);
  if (mx === 0) mx = 1.0;
  for (let i = 0; i < xd.length; i += 1) xd[i] /= mx;

  const sp = negThCross(xd, 0.0);
  const ppi = new Float64Array(Math.max(0, sp.length - 1));
  for (let i = 1; i < sp.length; i += 1) ppi[i - 1] = (sp[i] - sp[i - 1]) / Fs;

  const N = sp.length;
  const ppiAvg = ppi.length ? mean(ppi) : NaN;
  const pr1 = pyRound((N * 60) / t);
  const pr2 = ppiAvg && !Number.isNaN(ppiAvg) ? pyRound(60 / ppiAvg) : 0;

  return { pr1, pr2, sp, ppi, ySmooth, xd };
}

/** `siv_Rhythm.m` - regular (1) / irregular (0) from pulse-interval variability. */
export function rhythm(rri: ArrayLike<number>): number {
  if (rri.length === 0) return 0;
  const avg = mean(rri);
  for (let i = 0; i < rri.length; i += 1) {
    if (Math.abs(rri[i] - avg) > 0.12) return 0;
  }
  return 1;
}

export interface RhythmAmdfResult {
  flag: number;
  segmentPr: number[];
  segmentSqa: number[];
}

/**
 * `siv_Rhythm_AMDF.m` - per-10s-segment AMDF pulse-rate check against a
 * reference PR. The loop stops when a segment would run past the end of `x`,
 * so a 30 s capture simply yields three segments instead of six.
 */
export function rhythmAmdf(
  x: ArrayLike<number>,
  Fs: number,
  refPr: number,
  nSegments = 6,
  segSeconds = 10,
): RhythmAmdfResult {
  const BL = Math.trunc(segSeconds * Fs);
  const segmentPr: number[] = [];
  const segmentSqa: number[] = [];

  for (let i = 0; i < nSegments; i += 1) {
    const n1 = i * BL;
    const ne = n1 + BL;
    if (ne > x.length) break;

    const x1 = sliceOf(x, n1, ne);
    const A = amdf(x1);
    const m = mean(A);
    for (let k = 0; k < A.length; k += 1) A[k] -= m;
    let famp = maxAbs(A);
    if (famp === 0) famp = 1.0;
    for (let k = 0; k < A.length; k += 1) A[k] /= famp;

    const locs2 = [...peakannoAmdf(negate(A))];
    if (locs2[0] > 5 && locs2[0] <= A.length - 5) {
      const lo = locs2[0] - 5;
      const hi = locs2[0] + 6;
      const ref = argMin(A.slice(lo, hi));
      locs2[0] = lo + ref;
    }

    const lag = locs2[0] + 1;
    const pr = lag > 0 ? Math.floor((60 * Fs) / lag) : 0;
    segmentPr.push(pr);
    segmentSqa.push(sqa(x1, A, locs2, pr));
  }

  const good = segmentPr.filter((_, i) => segmentSqa[i] === 0);
  let flag = 0;
  if (good.length > 1) {
    flag = good.some((pr) => Math.abs(pr - refPr) > 5) ? 0 : 1;
  }

  return { flag, segmentPr, segmentSqa };
}

function sliceOf(x: ArrayLike<number>, from: number, to: number): Float64Array {
  const out = new Float64Array(to - from);
  for (let i = from; i < to; i += 1) out[i - from] = x[i];
  return out;
}
