/**
 * NumPy/SciPy primitives needed by the on-device pipeline.
 *
 * Each function mirrors the semantics of its Python counterpart exactly,
 * including the edge cases that differ between the two languages. The one that
 * bites hardest is rounding: Python's `round()` is round-half-to-even, while
 * JavaScript's `Math.round` rounds half away from zero. The pipeline rounds
 * pulse rates, so a naive `Math.round` would disagree with the backend on any
 * value landing exactly on .5.
 */

/** Python's `round()` - banker's rounding (half to even). */
export function pyRound(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  // Exactly .5: round to the even neighbour.
  return Math.abs(floor % 2) === 0 ? floor : floor + 1;
}

export function mean(x: ArrayLike<number>): number {
  const n = x.length;
  if (n === 0) return NaN;
  let acc = 0;
  for (let i = 0; i < n; i += 1) acc += x[i];
  return acc / n;
}

/** `np.std` with the NumPy default `ddof=0` (population standard deviation). */
export function std(x: ArrayLike<number>): number {
  const n = x.length;
  if (n === 0) return NaN;
  const m = mean(x);
  let acc = 0;
  for (let i = 0; i < n; i += 1) {
    const d = x[i] - m;
    acc += d * d;
  }
  return Math.sqrt(acc / n);
}

export function maxAbs(x: ArrayLike<number>): number {
  let worst = 0;
  for (let i = 0; i < x.length; i += 1) {
    const v = Math.abs(x[i]);
    if (v > worst) worst = v;
  }
  return worst;
}

export function diff(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  if (n < 2) return new Float64Array(0);
  const out = new Float64Array(n - 1);
  for (let i = 1; i < n; i += 1) out[i - 1] = x[i] - x[i - 1];
  return out;
}

/** `np.argmin` - index of the first minimum. */
export function argMin(x: ArrayLike<number>): number {
  let best = 0;
  for (let i = 1; i < x.length; i += 1) {
    if (x[i] < x[best]) best = i;
  }
  return best;
}

/**
 * `np.gradient` with unit spacing: central differences in the interior and
 * first-order one-sided differences at the two ends.
 */
export function gradient(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (n === 1) {
    out[0] = 0;
    return out;
  }
  out[0] = x[1] - x[0];
  out[n - 1] = x[n - 1] - x[n - 2];
  for (let i = 1; i < n - 1; i += 1) out[i] = (x[i + 1] - x[i - 1]) / 2;
  return out;
}

/**
 * `np.arange(start, stop, step)` - computed as `start + i * step` so the
 * floating-point accumulation matches NumPy rather than drifting.
 */
export function arange(start: number, stop: number, step: number): Float64Array {
  const count = Math.max(0, Math.ceil((stop - start) / step));
  const out = new Float64Array(count);
  for (let i = 0; i < count; i += 1) out[i] = start + i * step;
  return out;
}

/**
 * `np.interp` - piecewise-linear interpolation. `xp` must be increasing;
 * values outside the range clamp to the endpoints, as NumPy does.
 */
export function interp(
  x: ArrayLike<number>,
  xp: ArrayLike<number>,
  fp: ArrayLike<number>,
): Float64Array {
  const out = new Float64Array(x.length);
  const n = xp.length;
  if (n === 0) return out;

  let j = 0;
  for (let i = 0; i < x.length; i += 1) {
    const target = x[i];
    if (target <= xp[0]) {
      out[i] = fp[0];
      continue;
    }
    if (target >= xp[n - 1]) {
      out[i] = fp[n - 1];
      continue;
    }
    // xp is sorted and the queries are too, so the cursor only moves forward.
    while (j < n - 2 && xp[j + 1] < target) j += 1;
    while (j > 0 && xp[j] > target) j -= 1;
    const span = xp[j + 1] - xp[j];
    out[i] = span === 0 ? fp[j] : fp[j] + ((target - xp[j]) * (fp[j + 1] - fp[j])) / span;
  }
  return out;
}

/** `scipy.signal.detrend(x)` with the default `type='linear'`. */
export function detrend(x: ArrayLike<number>): Float64Array {
  const n = x.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (n === 1) {
    out[0] = 0;
    return out;
  }

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
  for (let i = 0; i < n; i += 1) out[i] = x[i] - (slope * i + intercept);
  return out;
}

/**
 * Power spectrum of `np.fft.rfft(x, n=nfft)`, i.e. `|rfft|**2`.
 *
 * `nfft` must be a power of two (the pipeline uses 4096). The input is
 * zero-padded, matching NumPy's behaviour when `n > len(x)`.
 */
export function rfftPowerSpectrum(x: ArrayLike<number>, nfft: number): Float64Array {
  const re = new Float64Array(nfft);
  const im = new Float64Array(nfft);
  const copy = Math.min(x.length, nfft);
  for (let i = 0; i < copy; i += 1) re[i] = x[i];

  // Bit-reversal permutation.
  for (let i = 1, j = 0; i < nfft; i += 1) {
    let bit = nfft >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i];
      re[i] = re[j];
      re[j] = tr;
      const ti = im[i];
      im[i] = im[j];
      im[j] = ti;
    }
  }

  // Iterative radix-2 Cooley-Tukey.
  for (let len = 2; len <= nfft; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);
    for (let i = 0; i < nfft; i += len) {
      let curRe = 1;
      let curIm = 0;
      for (let k = 0; k < len / 2; k += 1) {
        const uRe = re[i + k];
        const uIm = im[i + k];
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm;
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe;
        re[i + k] = uRe + vRe;
        im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe;
        im[i + k + len / 2] = uIm - vIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }

  const bins = Math.floor(nfft / 2) + 1;
  const power = new Float64Array(bins);
  for (let i = 0; i < bins; i += 1) power[i] = re[i] * re[i] + im[i] * im[i];
  return power;
}

/** `np.fft.rfftfreq(nfft, d)`. */
export function rfftFreq(nfft: number, d: number): Float64Array {
  const bins = Math.floor(nfft / 2) + 1;
  const out = new Float64Array(bins);
  for (let i = 0; i < bins; i += 1) out[i] = i / (nfft * d);
  return out;
}

export function clip(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
