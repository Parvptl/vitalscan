/**
 * Integration test for the capture loop and measurement state machine.
 *
 * jsdom has no camera and no compositor, so this drives the engine with a
 * fake MediaStream, a fake canvas context that paints a synthetic torch-lit
 * fingertip, and a controllable requestVideoFrameCallback. That lets the whole
 * state machine run - placement -> signal check -> countdown -> measuring ->
 * complete - with real frame statistics flowing through the real code paths.
 */

import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMeasurementEngine } from './useMeasurementEngine';
import type { CaptureMeta, FrameSignals } from '../types/measurement';

const FPS = 30;
const BPM = 78;

let frameCallbacks: Array<(now: number, meta: { mediaTime: number }) => void> = [];
let mediaTime = 0;
let pixelSource: () => [number, number, number] = () => [0, 0, 0];

/** A torch-lit fingertip pulsing at BPM. */
function fingerPixels(t: number): [number, number, number] {
  const ph = 2 * Math.PI * (BPM / 60) * t;
  const ac = Math.sin(ph) + 0.35 * Math.sin(2 * ph + 0.9);
  return [205 + ac * 7, 58 + ac * 1.8, 34 + ac * 0.9];
}

/** An uncovered lens: balanced channels with spatial structure. */
function roomPixels(): [number, number, number] {
  return [120, 115, 108];
}

function installFakes() {
  frameCallbacks = [];
  mediaTime = 0;
  pixelSource = () => fingerPixels(mediaTime);

  const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
  proto.requestVideoFrameCallback = function (cb: (now: number, meta: { mediaTime: number }) => void) {
    frameCallbacks.push(cb);
    return frameCallbacks.length;
  };
  proto.cancelVideoFrameCallback = function () {};
  proto.play = function () {
    return Promise.resolve();
  };
  Object.defineProperty(HTMLVideoElement.prototype, 'readyState', {
    configurable: true,
    get: () => 4,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
    configurable: true,
    get: () => 640,
  });
  Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
    configurable: true,
    get: () => 480,
  });

  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
    const canvas = this;
    return {
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
      drawImage: () => {},
      getImageData: () => {
        const n = canvas.width * canvas.height;
        const data = new Uint8ClampedArray(n * 4);
        const [r, g, b] = pixelSource();
        for (let i = 0; i < n; i += 1) {
          data[i * 4] = r;
          data[i * 4 + 1] = g;
          data[i * 4 + 2] = b;
          data[i * 4 + 3] = 255;
        }
        return { data };
      },
    } as unknown as CanvasRenderingContext2D;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;

  const track = {
    readyState: 'live',
    stop: () => {},
    getSettings: () => ({ facingMode: 'environment', width: 640, height: 480 }),
    getCapabilities: () => ({}), // no torch - exercises the manual-flash fallback
    applyConstraints: () => Promise.resolve(),
  } as unknown as MediaStreamTrack;
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;

  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue(stream) },
  });
  Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
}

/** Deliver `count` camera frames, advancing the media clock at FPS. */
function deliverFrames(count: number) {
  for (let i = 0; i < count; i += 1) {
    mediaTime += 1 / FPS;
    const pending = frameCallbacks;
    frameCallbacks = [];
    pending.forEach((cb) => cb(performance.now(), { mediaTime }));
  }
}

interface HarnessProps {
  durationS: number;
  onComplete: (signals: FrameSignals, meta: CaptureMeta) => void;
  expose: (engine: ReturnType<typeof useMeasurementEngine>) => void;
}

function Harness({ durationS, onComplete, expose }: HarnessProps) {
  const engine = useMeasurementEngine({ durationS, onComplete });
  expose(engine);
  useEffect(() => {
    void engine.requestCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <video ref={engine.attachVideo} />;
}

describe('useMeasurementEngine', () => {
  let engine: ReturnType<typeof useMeasurementEngine>;
  let completed: { signals: FrameSignals; meta: CaptureMeta } | null;

  beforeEach(() => {
    installFakes();
    completed = null;
    // `performance` must be faked too: the engine's clocks (countdown, elapsed
    // capture time, stall detection) are all driven by performance.now().
    vi.useFakeTimers({
      shouldAdvanceTime: true,
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'requestAnimationFrame',
        'cancelAnimationFrame',
        'performance',
        'Date',
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  async function mount(durationS = 2) {
    await act(async () => {
      render(
        <Harness
          durationS={durationS}
          onComplete={(signals, meta) => {
            completed = { signals, meta };
          }}
          expose={(e) => {
            engine = e;
          }}
        />,
      );
    });
  }

  /** Run the engine for `seconds` of camera time, ticking its UI heartbeat. */
  async function run(seconds: number) {
    const chunks = Math.ceil(seconds * 5); // 200 ms heartbeat
    for (let i = 0; i < chunks; i += 1) {
      await act(async () => {
        deliverFrames(FPS / 5);
        await vi.advanceTimersByTimeAsync(200);
      });
    }
  }

  it('detects a covered lens and becomes ready for a steady signal', async () => {
    await mount();
    await run(5);
    expect(['SIGNAL_GOOD', 'READY', 'FINGER_DETECTED', 'SIGNAL_WEAK']).toContain(
      engine.snapshot.placement,
    );
    expect(engine.snapshot.placement).not.toBe('NO_FINGER');
  });

  it('reports NO_FINGER while the lens is uncovered', async () => {
    pixelSource = () => roomPixels();
    await mount();
    await run(3);
    expect(engine.snapshot.placement).toBe('NO_FINGER');
    expect(engine.canStart).toBe(false);
  });

  it('falls back to the manual flashlight when the track has no torch', async () => {
    await mount();
    await run(1);
    expect(engine.snapshot.torchSupported).toBe(false);
    expect(engine.snapshot.torchOn).toBe(false);
  });

  it('runs the countdown then the timed capture and hands over the signals', async () => {
    await mount(2);
    await run(4);

    await act(async () => {
      engine.beginCountdown();
    });
    await run(7); // 3 s countdown + 2 s capture, with margin

    expect(completed).not.toBeNull();
    const { signals, meta } = completed!;
    expect(signals.gray.length).toBeGreaterThan(FPS); // ~2 s at 30 fps
    expect(signals.gray.length).toBe(signals.red.length);
    expect(signals.gray.length).toBe(signals.timestamps.length);
    expect(meta.facing_mode).toBe('environment');
    expect(meta.torch_enabled).toBe(false);
    // Notebook cell 4: RESIZE_FACTOR 0.1 of a 640x480 frame.
    expect(meta.roi_width).toBe(64);
    expect(meta.roi_height).toBe(48);
  });

  it('captures a signal that actually carries the pulse', async () => {
    await mount(2);
    await run(4);
    await act(async () => engine.beginCountdown());
    await run(7);

    const gray = completed!.signals.gray;
    const mean = gray.reduce((a, b) => a + b, 0) / gray.length;
    const peak = Math.max(...gray.map((v) => Math.abs(v - mean)));
    expect(peak).toBeGreaterThan(0.5); // real pulsatile variation, not a flat line
    expect(Math.min(...gray)).toBeGreaterThan(0);
    expect(Math.max(...gray)).toBeLessThan(256);
  });

  it('timestamps samples on the media clock', async () => {
    await mount(2);
    await run(4);
    await act(async () => engine.beginCountdown());
    await run(7);

    const t = completed!.signals.timestamps;
    for (let i = 1; i < t.length; i += 1) {
      expect(t[i]).toBeGreaterThan(t[i - 1]);
    }
    const effective = (t.length - 1) / (t[t.length - 1] - t[0]);
    expect(effective).toBeCloseTo(FPS, 0);
  });

  it('aborts the capture when the finger is lifted', async () => {
    await mount(10);
    await run(4);
    await act(async () => engine.beginCountdown());
    await run(3.5); // through the countdown, into the capture

    pixelSource = () => roomPixels();
    await run(3);

    expect(engine.snapshot.phase).toBe('ERROR');
    expect(engine.snapshot.error?.code).toBe('FINGER_LOST');
    expect(completed).toBeNull();
  });

  it('reports an honest error when the browser delivers no frames', async () => {
    const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
    proto.requestVideoFrameCallback = function () {
      return 1; // accepted but never invoked
    };
    await mount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9000);
    });
    expect(engine.snapshot.phase).toBe('ERROR');
    expect(engine.snapshot.error?.code).toBe('CAMERA_UNAVAILABLE');
  });

  it('exposes a live waveform window without re-rendering per frame', async () => {
    await mount();
    await run(3);
    const window = engine.getWaveWindow(60);
    expect(window.length).toBeGreaterThan(0);
    expect(window.every((v) => v > 0 && v < 256)).toBe(true);
  });
});
