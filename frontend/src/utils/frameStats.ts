/**
 * Per-frame optical signal extraction - the browser equivalent of notebook
 * cell 9.
 *
 * The notebook spatially downsamples each frame by RESIZE_FACTOR (0.1) with
 * INTER_AREA, then takes the summed grayscale intensity and the mean of each
 * colour channel. Here the downsample is done by the 2D canvas when the video
 * frame is drawn into a small backing store with image smoothing enabled
 * (a box/area-style reduction), and the reduction over the small buffer is a
 * plain average.
 *
 * DOCUMENTED ADAPTATION: we report the MEAN grayscale value rather than the
 * SUM. The notebook's next two steps are `d - mean(d)` followed by division by
 * `max|d - mean(d)|`, so a constant pixel-count factor cancels exactly; the
 * resulting rPPG signal is identical. Keeping the value in 0-255 also lets the
 * API validate the payload as an intensity.
 *
 * Grayscale uses the same ITU-R BT.601 weights as cv2.COLOR_BGR2GRAY.
 */

export const GRAY_R = 0.299;
export const GRAY_G = 0.587;
export const GRAY_B = 0.114;

export interface FrameStats {
  /** Mean grayscale intensity, 0-255 (notebook's d_gray up to a constant). */
  gray: number;
  /** Mean channel intensities, 0-255 (notebook's d_R / d_G / d_B). */
  red: number;
  green: number;
  blue: number;
  /** Spatial standard deviation of the red channel - used only to judge
   * whether the lens is evenly covered, never as a measurement. */
  redStdDev: number;
  /** Fraction of pixels at/near sensor saturation (>= 250). */
  saturatedFraction: number;
}

/**
 * Reduce an RGBA buffer to the per-frame signals above. Written as a single
 * pass over a typed array so it stays well under a frame budget at 30 fps.
 */
export function reduceFrame(data: Uint8ClampedArray): FrameStats {
  const pixels = data.length / 4;
  if (pixels === 0) {
    return { gray: 0, red: 0, green: 0, blue: 0, redStdDev: 0, saturatedFraction: 0 };
  }

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumRR = 0;
  let saturated = 0;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    sumR += r;
    sumG += g;
    sumB += b;
    sumRR += r * r;
    if (r >= 250) saturated += 1;
  }

  const red = sumR / pixels;
  const green = sumG / pixels;
  const blue = sumB / pixels;
  const variance = Math.max(0, sumRR / pixels - red * red);

  return {
    gray: GRAY_R * red + GRAY_G * green + GRAY_B * blue,
    red,
    green,
    blue,
    redStdDev: Math.sqrt(variance),
    saturatedFraction: saturated / pixels,
  };
}

/**
 * Growable typed-array buffers for a capture session.
 *
 * Frame samples are appended here from the capture loop; they never pass
 * through React state, so a 30 fps stream costs no re-renders.
 */
export class SignalRecorder {
  private capacity: number;
  private length = 0;
  private t: Float64Array;
  private gray: Float64Array;
  private red: Float64Array;
  private green: Float64Array;
  private blue: Float64Array;

  constructor(initialCapacity = 2048) {
    this.capacity = initialCapacity;
    this.t = new Float64Array(initialCapacity);
    this.gray = new Float64Array(initialCapacity);
    this.red = new Float64Array(initialCapacity);
    this.green = new Float64Array(initialCapacity);
    this.blue = new Float64Array(initialCapacity);
  }

  get size(): number {
    return this.length;
  }

  private grow(): void {
    const next = this.capacity * 2;
    const copy = (src: Float64Array) => {
      const out = new Float64Array(next);
      out.set(src);
      return out;
    };
    this.t = copy(this.t);
    this.gray = copy(this.gray);
    this.red = copy(this.red);
    this.green = copy(this.green);
    this.blue = copy(this.blue);
    this.capacity = next;
  }

  push(timestampS: number, stats: FrameStats): void {
    if (this.length === this.capacity) this.grow();
    const i = this.length;
    this.t[i] = timestampS;
    this.gray[i] = stats.gray;
    this.red[i] = stats.red;
    this.green[i] = stats.green;
    this.blue[i] = stats.blue;
    this.length = i + 1;
  }

  reset(): void {
    this.length = 0;
  }

  /**
   * Drop all but the most recent `n` samples. Used while the camera is idling
   * in the placement stage so preview memory stays bounded no matter how long
   * the user takes to get set up.
   */
  trimTo(n: number): void {
    if (this.length <= n) return;
    const start = this.length - n;
    const shift = (a: Float64Array) => a.copyWithin(0, start, this.length);
    shift(this.t);
    shift(this.gray);
    shift(this.red);
    shift(this.green);
    shift(this.blue);
    this.length = n;
  }

  /** Most recent `n` grayscale samples, for the live waveform / quality check. */
  tailGray(n: number): Float64Array {
    const start = Math.max(0, this.length - n);
    return this.gray.slice(start, this.length);
  }

  tailTimestamps(n: number): Float64Array {
    const start = Math.max(0, this.length - n);
    return this.t.slice(start, this.length);
  }

  durationS(): number {
    if (this.length < 2) return 0;
    return this.t[this.length - 1] - this.t[0];
  }

  /** Plain-array payload for the API. Called once, at the end of a capture. */
  toPayload() {
    const slice = (a: Float64Array) => Array.from(a.subarray(0, this.length));
    return {
      timestamps: slice(this.t),
      gray: slice(this.gray),
      red: slice(this.red),
      green: slice(this.green),
      blue: slice(this.blue),
    };
  }
}
