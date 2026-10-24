/**
 * SciPy-compatible `lfilter` / `lfilter_zi` / `filtfilt`.
 *
 * This is the only part of the signal chain that is genuinely re-implemented
 * for the on-device pipeline - the Chebyshev and Butterworth designs are not,
 * their coefficients come straight out of SciPy (see `filterCoefficients.ts`).
 *
 * The behaviour reproduced here is `scipy.signal.filtfilt(b, a, x)` with its
 * defaults: `padtype='odd'`, `padlen=3 * max(len(a), len(b))`, and zero-phase
 * forward/backward passes initialised from `lfilter_zi`. Every step is
 * asserted element-wise against SciPy's own output in `parity.test.ts`.
 */

/** Solve `A z = rhs` by Gaussian elimination with partial pivoting. */
function solve(A: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const m = A.map((row, i) => [...row, rhs[i]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (pivot !== col) {
      const tmp = m[col];
      m[col] = m[pivot];
      m[pivot] = tmp;
    }
    const diag = m[col][col];
    if (diag === 0) continue; // singular; mirrors numpy raising, handled by caller
    for (let r = col + 1; r < n; r += 1) {
      const factor = m[r][col] / diag;
      if (factor === 0) continue;
      for (let c = col; c <= n; c += 1) m[r][c] -= factor * m[col][c];
    }
  }

  const out = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i -= 1) {
    let acc = m[i][n];
    for (let j = i + 1; j < n; j += 1) acc -= m[i][j] * out[j];
    out[i] = m[i][i] === 0 ? 0 : acc / m[i][i];
  }
  return out;
}

/**
 * `scipy.signal.lfilter_zi` - the initial state for a step response of unit
 * amplitude, i.e. the solution of `(I - A^T) zi = B` where `A` is the
 * companion matrix of `a`.
 */
export function lfilterZi(bIn: number[], aIn: number[]): number[] {
  let b = [...bIn];
  let a = [...aIn];
  if (a[0] !== 1) {
    b = b.map((v) => v / a[0]);
    a = a.map((v) => v / a[0]);
  }
  const n = Math.max(a.length, b.length);
  while (a.length < n) a.push(0);
  while (b.length < n) b.push(0);

  const size = n - 1;
  if (size < 1) return [];

  // companion(a).T, subtracted from the identity.
  // companion(a)[0][j] = -a[j + 1] / a[0]; companion(a)[i][i - 1] = 1.
  const IminusAT: number[][] = [];
  for (let i = 0; i < size; i += 1) {
    const row = new Array<number>(size).fill(0);
    row[i] = 1;
    // transpose of first row of companion -> first column of the transpose
    row[0] -= -a[i + 1];
    // transpose of the sub-diagonal ones
    if (i + 1 < size) row[i + 1] -= 1;
    IminusAT[i] = row;
  }

  const B: number[] = [];
  for (let i = 0; i < size; i += 1) B.push(b[i + 1] - a[i + 1] * b[0]);

  return solve(IminusAT, B);
}

/** `scipy.signal.lfilter` (direct form II transposed) with optional initial state. */
export function lfilter(
  bIn: number[],
  aIn: number[],
  x: ArrayLike<number>,
  zi?: number[],
): { y: Float64Array; zf: number[] } {
  let b = [...bIn];
  let a = [...aIn];
  if (a[0] !== 1) {
    b = b.map((v) => v / a[0]);
    a = a.map((v) => v / a[0]);
  }
  const n = Math.max(a.length, b.length);
  while (a.length < n) a.push(0);
  while (b.length < n) b.push(0);

  const order = n - 1;
  const z = new Array<number>(Math.max(order, 0)).fill(0);
  if (zi) for (let i = 0; i < order; i += 1) z[i] = zi[i] ?? 0;

  const len = x.length;
  const y = new Float64Array(len);

  for (let i = 0; i < len; i += 1) {
    const xi = x[i];
    const yi = b[0] * xi + (order > 0 ? z[0] : 0);
    for (let j = 0; j < order - 1; j += 1) {
      z[j] = b[j + 1] * xi + z[j + 1] - a[j + 1] * yi;
    }
    if (order > 0) z[order - 1] = b[order] * xi - a[order] * yi;
    y[i] = yi;
  }

  return { y, zf: z };
}

function reversed(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) out[i] = x[n - 1 - i];
  return out;
}

/**
 * `scipy.signal.filtfilt(b, a, x)` with default `padtype='odd'`.
 *
 * `padlen` defaults to `3 * max(len(a), len(b))`; callers may override it,
 * which the moving-average path does for very short inputs exactly as the
 * Python `moving_avg_fil` does.
 */
export function filtfilt(
  b: number[],
  a: number[],
  x: ArrayLike<number>,
  padlenOverride?: number,
): Float64Array {
  const ntaps = Math.max(a.length, b.length);
  const padlen = padlenOverride ?? 3 * ntaps;
  const n = x.length;

  if (n <= padlen) {
    throw new Error(
      `filtfilt: the length of the input vector must be greater than padlen (${padlen}).`,
    );
  }

  // Odd extension: 2*x[0] - x[padlen:0:-1] at the front, mirrored at the back.
  let ext: Float64Array;
  if (padlen > 0) {
    ext = new Float64Array(n + 2 * padlen);
    for (let i = 0; i < padlen; i += 1) ext[i] = 2 * x[0] - x[padlen - i];
    for (let i = 0; i < n; i += 1) ext[padlen + i] = x[i];
    for (let i = 0; i < padlen; i += 1) {
      ext[padlen + n + i] = 2 * x[n - 1] - x[n - 2 - i];
    }
  } else {
    ext = new Float64Array(n);
    for (let i = 0; i < n; i += 1) ext[i] = x[i];
  }

  const zi = lfilterZi(b, a);

  // Forward pass, seeded with zi scaled by the first sample.
  const ziF = zi.map((v) => v * ext[0]);
  const forward = lfilter(b, a, ext, ziF).y;

  // Backward pass over the reversed forward result.
  const rev = reversed(forward);
  const ziB = zi.map((v) => v * rev[0]);
  const backward = lfilter(b, a, rev, ziB).y;

  const out = reversed(backward);
  return out.slice(padlen, padlen + n);
}
