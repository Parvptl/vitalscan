/**
 * Stage-by-stage parity against the Python pipeline.
 *
 * Fixtures in `__fixtures__/parity.json` are produced by running the real
 * backend pipeline (`backend/tools/export_js_reference.py`), which is itself
 * verified against the notebook by `backend/tests/test_notebook_parity.py`.
 * So this suite transitively ties the on-device TypeScript implementation back
 * to `reference/Finger_Pulse_rPPG_Analysis_New.ipynb`.
 *
 * A divergence anywhere in the chain fails here, at the stage where it starts.
 */

import { describe, expect, it } from 'vitest';
import fixtures from './__fixtures__/parity.json';
import {
  assessRhythm,
  estimateRr,
  estimateSpo2Pi,
  preprocess,
  pulseRate,
  toUniformGrid,
} from './stages';

interface PipelineCase {
  name: string;
  input: {
    fps: number;
    durationS: number;
    timestamps: number[];
    gray: number[];
    red: number[];
    green: number[];
    blue: number[];
  };
  expected: {
    x: number[];
    dA: number[];
    peaks: number[];
    ppi: number[];
    ySmooth: number[];
    amdfCurve: number[];
    amdfLocs: number[];
    prCount: number;
    prPpi: number;
    prAmdf: number;
    fused: number | null;
    sqaFlag: number;
    rhythmPpi: boolean;
    rhythmAmdf: boolean;
    segmentPr: number[];
    segmentSqa: number[];
    spo2: number;
    perfusionIndex: number;
    ratioOfRatios: number;
    respiratoryRate: number | null;
  };
}

const cases = fixtures.pipeline as PipelineCase[];

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) worst = d;
  }
  return worst;
}

/** Tight enough that any real algorithmic divergence fails. */
const TOL = 1e-9;

describe('on-device pipeline matches the Python backend', () => {
  it('covers several rates, durations and frame rates', () => {
    expect(cases.length).toBeGreaterThanOrEqual(4);
    expect(cases.some((c) => c.input.fps !== 30)).toBe(true);
    expect(cases.some((c) => c.input.durationS === 60)).toBe(true);
  });

  cases.forEach((c) => {
    describe(c.name, () => {
      const { fps, durationS, gray, red, blue } = c.input;
      const pre = preprocess(gray, fps);
      const pr = pulseRate(pre.x, fps, durationS);

      it('preprocessing (cell 11): normalised and high-pass filtered signal', () => {
        expect(maxAbsDiff(pre.dA, c.expected.dA)).toBeLessThan(TOL);
        expect(pre.x.length).toBe(c.expected.x.length);
        expect(maxAbsDiff(pre.x, c.expected.x)).toBeLessThan(TOL);
      });

      it('systolic peak detection (cell 15): identical peak indices', () => {
        expect(pr.peaks).toEqual(c.expected.peaks);
        expect(maxAbsDiff(pr.ppi, c.expected.ppi)).toBeLessThan(TOL);
        expect(maxAbsDiff(pr.ySmooth, c.expected.ySmooth)).toBeLessThan(TOL);
      });

      it('AMDF curve and minima', () => {
        expect(maxAbsDiff(pr.amdfCurve, c.expected.amdfCurve)).toBeLessThan(TOL);
        expect(pr.amdfLocs).toEqual(c.expected.amdfLocs);
      });

      it('all three pulse-rate estimates and the fusion rule (cells 15 + 16)', () => {
        expect(pr.prCount).toBe(c.expected.prCount);
        expect(pr.prPpi).toBe(c.expected.prPpi);
        expect(pr.prAmdf).toBe(c.expected.prAmdf);
        expect(pr.fused).toBe(c.expected.fused);
      });

      it('signal quality assessment (siv_SQA)', () => {
        expect(pr.sqaFlag).toBe(c.expected.sqaFlag);
      });

      it('rhythm regularity, both methods (cell 20)', () => {
        const refPr = pr.fused ?? pr.prAmdf;
        const rh = assessRhythm(pre.x, fps, pr.ppi, refPr);
        expect(rh.ppiRegular).toBe(c.expected.rhythmPpi);
        expect(rh.amdfRegular).toBe(c.expected.rhythmAmdf);
        expect(rh.segmentPr).toEqual(c.expected.segmentPr);
        expect(rh.segmentSqa).toEqual(c.expected.segmentSqa);
      });

      it('SpO2 and perfusion index (cell 22)', () => {
        const ox = estimateSpo2Pi(red, blue, fps);
        expect(Math.abs(ox.spo2 - c.expected.spo2)).toBeLessThan(TOL);
        expect(Math.abs(ox.perfusionIndex - c.expected.perfusionIndex)).toBeLessThan(TOL);
        expect(Math.abs(ox.ratioOfRatios - c.expected.ratioOfRatios)).toBeLessThan(TOL);
      });

      it('respiratory rate (cell 24)', () => {
        const rr = estimateRr(pr.peaks, fps, pr.ySmooth);
        if (c.expected.respiratoryRate === null) {
          expect(rr).toBeNull();
        } else {
          expect(rr).not.toBeNull();
          expect(Math.abs((rr as number) - c.expected.respiratoryRate)).toBeLessThan(1e-6);
        }
      });
    });
  });
});

describe('uniform resampling matches the Python resampler', () => {
  const fx = fixtures.resample as {
    input: { timestamps: number[]; gray: number[]; red: number[]; green: number[]; blue: number[] };
    expected: {
      fps: number;
      effectiveFps: number;
      durationS: number;
      droppedSamples: number;
      gray: number[];
      red: number[];
    };
  };

  it('recovers the same grid from jittered timestamps', () => {
    const u = toUniformGrid(
      fx.input.timestamps,
      fx.input.gray,
      fx.input.red,
      fx.input.green,
      fx.input.blue,
    );
    expect(u.fps).toBe(fx.expected.fps);
    expect(u.droppedSamples).toBe(fx.expected.droppedSamples);
    expect(Math.abs(u.effectiveFps - fx.expected.effectiveFps)).toBeLessThan(1e-12);
    expect(Math.abs(u.durationS - fx.expected.durationS)).toBeLessThan(1e-12);
    expect(maxAbsDiff(u.gray, fx.expected.gray)).toBeLessThan(TOL);
    expect(maxAbsDiff(u.red, fx.expected.red)).toBeLessThan(TOL);
  });
});

describe('honest failure modes, matching the backend', () => {
  it('rejects a constant signal instead of inventing a pulse', () => {
    expect(() => preprocess(new Array(900).fill(128), 30)).toThrow(/constant/);
  });

  it('reports no respiratory rate when too few peaks were detected', () => {
    expect(estimateRr([1, 2], 30, new Float64Array(900))).toBeNull();
  });

  it('refuses a frame rate with no filter design', () => {
    expect(() => preprocess(new Array(900).fill(0).map((_, i) => Math.sin(i)), 999)).toThrow(
      /filter design/,
    );
  });
});
