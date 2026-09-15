import { describe, expect, it } from 'vitest';
import { GRAY_B, GRAY_G, GRAY_R, reduceFrame, SignalRecorder } from './frameStats';

function rgbaBuffer(pixels: [number, number, number][]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(pixels.length * 4);
  pixels.forEach(([r, g, b], i) => {
    data[i * 4] = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  });
  return data;
}

describe('reduceFrame', () => {
  it('averages each colour channel', () => {
    const stats = reduceFrame(
      rgbaBuffer([
        [200, 60, 40],
        [100, 20, 0],
      ]),
    );
    expect(stats.red).toBe(150);
    expect(stats.green).toBe(40);
    expect(stats.blue).toBe(20);
  });

  it('uses the same grayscale weights as cv2.COLOR_BGR2GRAY', () => {
    const stats = reduceFrame(rgbaBuffer([[200, 100, 50]]));
    expect(stats.gray).toBeCloseTo(GRAY_R * 200 + GRAY_G * 100 + GRAY_B * 50, 10);
  });

  it('reports zero spatial spread for a uniform frame', () => {
    const stats = reduceFrame(rgbaBuffer(Array.from({ length: 16 }, () => [180, 40, 20] as [number, number, number])));
    expect(stats.redStdDev).toBeCloseTo(0, 6);
  });

  it('reports spatial spread for a structured frame', () => {
    const stats = reduceFrame(
      rgbaBuffer([
        [0, 0, 0],
        [255, 255, 255],
        [0, 0, 0],
        [255, 255, 255],
      ]),
    );
    expect(stats.redStdDev).toBeGreaterThan(100);
  });

  it('counts saturated pixels', () => {
    const stats = reduceFrame(
      rgbaBuffer([
        [255, 10, 10],
        [255, 10, 10],
        [10, 10, 10],
        [10, 10, 10],
      ]),
    );
    expect(stats.saturatedFraction).toBeCloseTo(0.5, 6);
  });

  it('handles an empty buffer without throwing', () => {
    expect(reduceFrame(new Uint8ClampedArray(0)).gray).toBe(0);
  });
});

describe('SignalRecorder', () => {
  const stats = (v: number) => ({
    gray: v,
    red: v * 2,
    green: v,
    blue: v / 2,
    redStdDev: 0,
    saturatedFraction: 0,
  });

  it('grows past its initial capacity without losing samples', () => {
    const rec = new SignalRecorder(4);
    for (let i = 0; i < 100; i += 1) rec.push(i / 30, stats(i));
    expect(rec.size).toBe(100);
    const payload = rec.toPayload();
    expect(payload.gray).toHaveLength(100);
    expect(payload.gray[99]).toBe(99);
    expect(payload.red[99]).toBe(198);
  });

  it('reports capture duration from the first and last timestamps', () => {
    const rec = new SignalRecorder();
    for (let i = 0; i < 90; i += 1) rec.push(i / 30, stats(i));
    expect(rec.durationS()).toBeCloseTo(89 / 30, 6);
  });

  it('keeps only the most recent samples when trimmed', () => {
    const rec = new SignalRecorder(8);
    for (let i = 0; i < 50; i += 1) rec.push(i, stats(i));
    rec.trimTo(10);
    expect(rec.size).toBe(10);
    const payload = rec.toPayload();
    expect(payload.gray[0]).toBe(40);
    expect(payload.gray[9]).toBe(49);
    expect(payload.timestamps[0]).toBe(40);
  });

  it('returns the tail window for the live waveform', () => {
    const rec = new SignalRecorder();
    for (let i = 0; i < 40; i += 1) rec.push(i, stats(i));
    const tail = rec.tailGray(5);
    expect(Array.from(tail)).toEqual([35, 36, 37, 38, 39]);
  });

  it('clears on reset', () => {
    const rec = new SignalRecorder();
    rec.push(0, stats(1));
    rec.reset();
    expect(rec.size).toBe(0);
    expect(rec.toPayload().gray).toHaveLength(0);
  });
});
