/**
 * filtfilt parity against SciPy.
 *
 * Vectors in `__fixtures__/parity.json` are produced by running the real
 * `scipy.signal.filtfilt` (see `backend/tools/export_js_reference.py`). If the
 * TypeScript port ever diverges numerically, these fail.
 */

import { describe, expect, it } from 'vitest';
import { filtfilt, lfilter, lfilterZi } from './filtfilt';
import fixtures from './__fixtures__/parity.json';

interface FiltfiltCase {
  name: string;
  b: number[];
  a: number[];
  x: number[];
  y: number[];
}

const cases = fixtures.filtfilt as FiltfiltCase[];

function maxAbsDiff(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let worst = 0;
  for (let i = 0; i < a.length; i += 1) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) worst = d;
  }
  return worst;
}

describe('filtfilt matches scipy.signal.filtfilt', () => {
  it('exports every designed filter plus the FIR moving-average cases', () => {
    expect(cases.length).toBeGreaterThanOrEqual(5);
    expect(cases.map((c) => c.name)).toContain('cheby1_highpass_30fps');
    expect(cases.map((c) => c.name)).toContain('moving_avg_3');
  });

  cases.forEach((c) => {
    it(`${c.name}: output matches element-wise`, () => {
      const y = filtfilt(c.b, c.a, c.x);
      expect(y.length).toBe(c.y.length);
      // Float64 round-trip through JSON, so an exact bit match is not expected;
      // 1e-9 is far tighter than any physiologically meaningful difference.
      expect(maxAbsDiff(y, c.y)).toBeLessThan(1e-9);
    });
  });
});

describe('lfilter / lfilterZi building blocks', () => {
  it('lfilterZi of an FIR moving average is the reversed partial sums', () => {
    // For a = [1], scipy's zi[i] = sum(b[i+1:]). Pin the known closed form so a
    // regression in the linear solve is obvious.
    const n = 4;
    const b = new Array(n).fill(1 / n);
    const zi = lfilterZi(b, [1]);
    expect(zi).toHaveLength(n - 1);
    for (let i = 0; i < n - 1; i += 1) {
      const expected = b.slice(i + 1).reduce((s, v) => s + v, 0);
      expect(zi[i]).toBeCloseTo(expected, 12);
    }
  });

  it('a unit-gain passthrough filter leaves the signal untouched', () => {
    const x = [1, 2, 3, 4, 5];
    const { y } = lfilter([1], [1], x);
    expect(Array.from(y)).toEqual(x);
  });

  it('lfilter normalises by a[0]', () => {
    const x = [1, 2, 3, 4];
    const scaled = lfilter([2], [2], x).y;
    expect(Array.from(scaled)).toEqual(x);
  });

  it('filtfilt rejects an input shorter than padlen, as scipy does', () => {
    const c = cases[0];
    expect(() => filtfilt(c.b, c.a, [1, 2, 3])).toThrow(/padlen/);
  });

  it('filtfilt is zero-phase: a symmetric input gives a symmetric output', () => {
    const n = 201;
    const x = Array.from({ length: n }, (_, i) => Math.exp(-((i - 100) ** 2) / 200));
    const c = cases.find((k) => k.name === 'moving_avg_11')!;
    const y = filtfilt(c.b, c.a, x);
    for (let i = 0; i < 40; i += 1) {
      expect(Math.abs(y[100 - i] - y[100 + i])).toBeLessThan(1e-10);
    }
  });
});
