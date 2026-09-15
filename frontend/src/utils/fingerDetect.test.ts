import { describe, expect, it } from 'vitest';
import { classifyPlacement, isCovered, liveQuality } from './fingerDetect';
import type { FrameStats } from './frameStats';

/** A torch-lit fingertip: bright, dominated by red, spatially flat. */
const COVERED: FrameStats = {
  gray: 92,
  red: 210,
  green: 55,
  blue: 30,
  redStdDev: 9,
  saturatedFraction: 0.05,
};

/** An uncovered lens looking at a room: balanced channels, lots of structure. */
const UNCOVERED: FrameStats = {
  gray: 110,
  red: 120,
  green: 115,
  blue: 108,
  redStdDev: 62,
  saturatedFraction: 0.02,
};

const GOOD_QUALITY = { perfusionPct: 0.4, bandPowerRatio: 0.6 };

describe('isCovered', () => {
  it('accepts a torch-lit fingertip', () => {
    expect(isCovered(COVERED)).toBe(true);
  });

  it('rejects an uncovered lens', () => {
    expect(isCovered(UNCOVERED)).toBe(false);
  });

  it('rejects a dark frame', () => {
    expect(isCovered({ ...COVERED, red: 10, green: 3, blue: 2 })).toBe(false);
  });

  it('rejects a frame with too much spatial structure', () => {
    expect(isCovered({ ...COVERED, redStdDev: 120 })).toBe(false);
  });

  it('rejects a frame that is not red-dominant', () => {
    expect(isCovered({ ...COVERED, green: 200, blue: 190 })).toBe(false);
  });
});

describe('classifyPlacement', () => {
  const base = { frameJump: 0.5, coveredForS: 4, quality: GOOD_QUALITY, goodForS: 0 };

  it('reports NO_FINGER when the lens is uncovered', () => {
    const v = classifyPlacement({ ...base, stats: UNCOVERED });
    expect(v.state).toBe('NO_FINGER');
    expect(v.canStart).toBe(false);
  });

  it('reports TOO_MUCH_MOVEMENT on a large frame-to-frame jump', () => {
    const v = classifyPlacement({ ...base, stats: COVERED, frameJump: 25 });
    expect(v.state).toBe('TOO_MUCH_MOVEMENT');
    expect(v.canStart).toBe(false);
  });

  it('reports DETECTING before enough history exists', () => {
    const v = classifyPlacement({ ...base, stats: COVERED, coveredForS: 0.3 });
    expect(v.state).toBe('DETECTING');
  });

  it('reports FINGER_DETECTED while waiting for the first quality result', () => {
    const v = classifyPlacement({ ...base, stats: COVERED, quality: null });
    expect(v.state).toBe('FINGER_DETECTED');
    expect(v.canStart).toBe(false);
  });

  it('reports SIGNAL_WEAK when pulsatility is too low', () => {
    const v = classifyPlacement({
      ...base,
      stats: COVERED,
      quality: { perfusionPct: 0.001, bandPowerRatio: 0.6 },
    });
    expect(v.state).toBe('SIGNAL_WEAK');
    expect(v.canStart).toBe(false);
  });

  it('reports SIGNAL_WEAK when in-band power is too low', () => {
    const v = classifyPlacement({
      ...base,
      stats: COVERED,
      quality: { perfusionPct: 0.4, bandPowerRatio: 0.05 },
    });
    expect(v.state).toBe('SIGNAL_WEAK');
  });

  it('reports SIGNAL_GOOD before the hold period elapses', () => {
    const v = classifyPlacement({ ...base, stats: COVERED, goodForS: 0.2 });
    expect(v.state).toBe('SIGNAL_GOOD');
    expect(v.canStart).toBe(false);
  });

  it('only reports READY after a sustained good signal', () => {
    const v = classifyPlacement({ ...base, stats: COVERED, goodForS: 3 });
    expect(v.state).toBe('READY');
    expect(v.canStart).toBe(true);
  });

  it('always provides a user-facing hint', () => {
    const states = [
      classifyPlacement({ ...base, stats: UNCOVERED }),
      classifyPlacement({ ...base, stats: COVERED, frameJump: 40 }),
      classifyPlacement({ ...base, stats: COVERED, goodForS: 9 }),
    ];
    states.forEach((v) => expect(v.hint.length).toBeGreaterThan(10));
  });
});

describe('liveQuality', () => {
  it('is POOR with no analysis yet', () => {
    expect(liveQuality(null, false)).toBe('POOR');
  });

  it('is POOR while moving, even with a strong signal', () => {
    expect(liveQuality(GOOD_QUALITY, true)).toBe('POOR');
  });

  it('is GOOD for a strong steady signal', () => {
    expect(liveQuality(GOOD_QUALITY, false)).toBe('GOOD');
  });

  it('is FAIR for a marginal signal', () => {
    expect(liveQuality({ perfusionPct: 0.08, bandPowerRatio: 0.3 }, false)).toBe('FAIR');
  });
});
