/**
 * Camera + torch control.
 *
 * Prefers the rear ("environment") camera and turns the torch on when the
 * platform actually exposes it. Torch control is unavailable on iOS Safari and
 * on many desktop browsers; that is handled as a normal, expected outcome -
 * the app falls back to asking the user to switch their flashlight on
 * manually, and never throws because of it.
 */

import { useCallback, useRef, useState } from 'react';
import type { AppError } from '../types/measurement';
import { cameraIsUsable, detectCapabilities, trackSupportsTorch } from '../utils/capabilities';

export interface CameraState {
  active: boolean;
  torchSupported: boolean;
  torchOn: boolean;
  facingMode: string | null;
  width: number | null;
  height: number | null;
}

const INITIAL: CameraState = {
  active: false,
  torchSupported: false,
  torchOn: false,
  facingMode: null,
  width: null,
  height: null,
};

function mapCameraError(err: unknown): AppError {
  const name = (err as DOMException)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      code: 'PERMISSION_DENIED',
      title: 'Camera permission needed',
      message:
        'VitalScan needs your camera to read the pulse in your fingertip. Allow camera access in your browser settings, then try again.',
      action: 'Try again',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      code: 'CAMERA_UNAVAILABLE',
      title: 'No usable camera found',
      message:
        'We could not find a camera on this device. A phone or tablet with a rear camera works best.',
      action: 'Try again',
    };
  }
  if (name === 'NotReadableError' || name === 'AbortError') {
    return {
      code: 'CAMERA_UNAVAILABLE',
      title: 'Camera is busy',
      message:
        'Another app or tab seems to be using the camera. Close it and try again.',
      action: 'Try again',
    };
  }
  return {
    code: 'CAMERA_UNAVAILABLE',
    title: 'Camera unavailable',
    message: 'We could not start the camera on this device.',
    action: 'Try again',
  };
}

/**
 * How long to keep looking for torch capability after the stream starts.
 *
 * Android Chrome does not always populate `getCapabilities().torch` at the
 * moment `getUserMedia` resolves - the track is `live`, but the camera
 * pipeline is still initialising, so a single check right after permission is
 * granted reports "no torch" on devices that do have one. We poll instead.
 */
const TORCH_POLL_ATTEMPTS = 12;
const TORCH_POLL_INTERVAL_MS = 250;

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function useCamera() {
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const torchOnRef = useRef(false);
  const [state, setState] = useState<CameraState>(INITIAL);

  const stop = useCallback(() => {
    const track = trackRef.current;
    if (track) {
      // Best-effort: leave the torch off so we don't strand the LED on.
      if (trackSupportsTorch(track)) {
        track.applyConstraints({ advanced: [{ torch: false }] } as MediaTrackConstraints).catch(
          () => undefined,
        );
      }
      track.stop();
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    torchOnRef.current = false;
    setState(INITIAL);
  }, []);

  /**
   * Switch the torch on as soon as the device admits it has one.
   *
   * Safe to call more than once: it no-ops once the torch is lit, and gives up
   * quietly on devices that genuinely have no torch (iOS Safari, most
   * desktops), leaving the manual-flashlight fallback in place.
   */
  const enableTorch = useCallback(async (): Promise<boolean> => {
    const track = trackRef.current;
    if (!track || torchOnRef.current) return torchOnRef.current;

    for (let attempt = 0; attempt < TORCH_POLL_ATTEMPTS; attempt += 1) {
      // Bail out if the camera was stopped or replaced while we were waiting.
      if (trackRef.current !== track || track.readyState !== 'live') return false;

      if (trackSupportsTorch(track)) {
        try {
          await track.applyConstraints({
            advanced: [{ torch: true }],
          } as MediaTrackConstraints);
          if (trackRef.current !== track) return false;
          torchOnRef.current = true;
          setState((s) => (s.torchSupported && s.torchOn ? s : { ...s, torchSupported: true, torchOn: true }));
          return true;
        } catch {
          // The device advertises a torch but refused to light it. Surface the
          // manual toggle rather than pretending the flash is on.
          setState((s) => (s.torchSupported ? s : { ...s, torchSupported: true }));
          return false;
        }
      }

      await delay(TORCH_POLL_INTERVAL_MS);
    }
    return false;
  }, []);

  const start = useCallback(async (): Promise<MediaStream> => {
    const caps = detectCapabilities();
    if (!caps.secureContext) {
      throw {
        code: 'CAMERA_UNSUPPORTED',
        title: 'Secure connection required',
        message:
          'Browsers only allow camera access over HTTPS (or on localhost). Open VitalScan over a secure link and try again.',
        action: 'Back to start',
      } satisfies AppError;
    }
    if (!cameraIsUsable(caps)) {
      throw {
        code: 'CAMERA_UNSUPPORTED',
        title: 'Camera not supported',
        message:
          'This browser does not provide the camera APIs VitalScan needs. Try the latest Chrome, Edge or Safari on a phone.',
        action: 'Back to start',
      } satisfies AppError;
    }

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 640 },
          height: { ideal: 480 },
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });
    } catch (err) {
      throw mapCameraError(err);
    }

    const track = stream.getVideoTracks()[0] ?? null;
    streamRef.current = stream;
    trackRef.current = track;
    torchOnRef.current = false;

    const settings = track?.getSettings?.() ?? {};

    setState({
      active: true,
      torchSupported: trackSupportsTorch(track),
      torchOn: false,
      facingMode: (settings.facingMode as string) ?? null,
      width: settings.width ?? null,
      height: settings.height ?? null,
    });

    // Light the torch in the background. Deliberately not awaited: the poll can
    // take a couple of seconds on a slow camera, and the permission flow must
    // not stall behind it. `enableTorch` updates state when it succeeds.
    void enableTorch();

    return stream;
  }, [enableTorch]);

  const setTorch = useCallback(async (on: boolean) => {
    const track = trackRef.current;
    if (!track || !trackSupportsTorch(track)) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] } as MediaTrackConstraints);
      torchOnRef.current = on;
      setState((s) => ({ ...s, torchOn: on }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const getStream = useCallback(() => streamRef.current, []);

  return { state, start, stop, setTorch, enableTorch, getStream };
}
