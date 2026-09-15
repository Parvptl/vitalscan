import { describe, expect, it } from 'vitest';
import { analyseWindow } from './signalQuality.worker';

function synth(hz: number, amplitude: number, dc = 150, fps = 30, seconds = 6): Float64Array {
  const n = Math.round(fps * seconds);
  const out = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    out[i] = dc + amplitude * Math.sin((2 * Math.PI * hz * i) / fps);
  }
  return out;
}

describe('analyseWindow', () => {
  it('returns an empty result for a window that is too short', () => {
    expect(analyseWindow(new Float64Array(4), 30).perfusionPct).toBe(0);
  });

  it('returns an empty result for an invalid frame rate', () => {
    expect(analyseWindow(synth(1.2, 1), 0).bandPowerRatio).toBe(0);
  });

  it('finds the dominant cardiac frequency', () => {
    const result = analyseWindow(synth(1.2, 1.5), 30); // 72 bpm
    expect(result.dominantHz).toBeCloseTo(1.2, 1);
    expect(result.bandPowerRatio).toBeGreaterThan(0.8);
  });

  it('recovers the AC/DC pulsatility of a clean sine', () => {
    // A sine of amplitude 1.5 on a DC of 150 has an RMS/DC of ~0.707%.
    const result = analyseWindow(synth(1.2, 1.5, 150), 30);
    expect(result.perfusionPct).toBeGreaterThan(0.4);
    expect(result.perfusionPct).toBeLessThan(1.2);
  });

  it('scores out-of-band drift as poor in-band power', () => {
    const result = analyseWindow(synth(0.08, 4), 30); // slow baseline wander
    expect(result.bandPowerRatio).toBeLessThan(0.25);
  });

  it('reports near-zero pulsatility for a flat signal', () => {
    const flat = new Float64Array(180).fill(140);
    expect(analyseWindow(flat, 30).perfusionPct).toBeCloseTo(0, 6);
  });
});
