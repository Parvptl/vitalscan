/**
 * Torch activation.
 *
 * The case that matters is a device whose `getCapabilities().torch` is not
 * populated at the instant `getUserMedia` resolves - the common Android Chrome
 * behaviour. A single check at permission time reports "no torch" there, so the
 * hook must keep looking.
 */

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCamera } from './useCamera';

interface FakeTrackOptions {
  /** ms after stream start before `torch` appears in capabilities. */
  torchAppearsAfterMs?: number;
  /** Device advertises a torch but refuses to light it. */
  refuseConstraint?: boolean;
  /** Device genuinely has no torch (iOS Safari, most desktops). */
  neverHasTorch?: boolean;
}

let applied: Array<Record<string, unknown>> = [];

function installFakeCamera(opts: FakeTrackOptions = {}) {
  const { torchAppearsAfterMs = 0, refuseConstraint = false, neverHasTorch = false } = opts;
  applied = [];
  const startedAt = Date.now();

  const track = {
    readyState: 'live',
    stop: vi.fn(),
    getSettings: () => ({ facingMode: 'environment', width: 640, height: 480 }),
    getCapabilities: () => {
      if (neverHasTorch) return {};
      return Date.now() - startedAt >= torchAppearsAfterMs ? { torch: true } : {};
    },
    applyConstraints: vi.fn(async (c: Record<string, unknown>) => {
      applied.push(c);
      if (refuseConstraint) throw new DOMException('refused', 'OverconstrainedError');
    }),
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
  return { track, stream };
}

function torchRequests() {
  return applied.filter((c) => {
    const adv = (c as { advanced?: Array<{ torch?: boolean }> }).advanced;
    return Array.isArray(adv) && adv.some((a) => a.torch === true);
  });
}

describe('useCamera torch activation', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lights the torch automatically when capability is immediately available', async () => {
    installFakeCamera({ torchAppearsAfterMs: 0 });
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(torchRequests()).toHaveLength(1);
    expect(result.current.state.torchOn).toBe(true);
    expect(result.current.state.torchSupported).toBe(true);
  });

  it('still lights the torch when capability only appears after the camera warms up', async () => {
    // The Android Chrome case that this fix exists for.
    installFakeCamera({ torchAppearsAfterMs: 900 });
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.start();
    });

    // Immediately after permission the device still reports no torch.
    expect(result.current.state.torchOn).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(torchRequests()).toHaveLength(1);
    expect(result.current.state.torchOn).toBe(true);
    expect(result.current.state.torchSupported).toBe(true);
  });

  it('does not block the permission flow while polling', async () => {
    installFakeCamera({ torchAppearsAfterMs: 2000 });
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.start();
    });

    // start() has already resolved and the camera is usable, torch pending.
    expect(result.current.state.active).toBe(true);
    expect(result.current.state.facingMode).toBe('environment');
  });

  it('gives up quietly on a device with no torch, leaving the manual fallback', async () => {
    installFakeCamera({ neverHasTorch: true });
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(torchRequests()).toHaveLength(0);
    expect(result.current.state.torchSupported).toBe(false);
    expect(result.current.state.torchOn).toBe(false);
    expect(result.current.state.active).toBe(true);
  });

  it('does not claim the flash is on when the device refuses the constraint', async () => {
    installFakeCamera({ refuseConstraint: true });
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });

    expect(result.current.state.torchOn).toBe(false);
    expect(result.current.state.torchSupported).toBe(true);
  });

  it('is idempotent - a second call does not re-apply the constraint', async () => {
    installFakeCamera({ torchAppearsAfterMs: 0 });
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await result.current.enableTorch();
      await result.current.enableTorch();
    });

    expect(torchRequests()).toHaveLength(1);
    expect(result.current.state.torchOn).toBe(true);
  });

  it('turns the torch off when the camera stops', async () => {
    installFakeCamera({ torchAppearsAfterMs: 0 });
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    act(() => {
      result.current.stop();
    });

    const offRequests = applied.filter((c) => {
      const adv = (c as { advanced?: Array<{ torch?: boolean }> }).advanced;
      return Array.isArray(adv) && adv.some((a) => a.torch === false);
    });
    expect(offRequests).toHaveLength(1);
    expect(result.current.state.torchOn).toBe(false);
    expect(result.current.state.active).toBe(false);
  });

  it('supports the manual toggle for devices where auto-on did not stick', async () => {
    installFakeCamera({ torchAppearsAfterMs: 0 });
    const { result } = renderHook(() => useCamera());

    await act(async () => {
      await result.current.start();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
      await result.current.setTorch(false);
    });
    expect(result.current.state.torchOn).toBe(false);

    await act(async () => {
      await result.current.setTorch(true);
    });
    expect(result.current.state.torchOn).toBe(true);
  });
});
