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

export function useCamera() {
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
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
    setState(INITIAL);
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

    const settings = track?.getSettings?.() ?? {};
    const torchSupported = trackSupportsTorch(track);

    let torchOn = false;
    if (torchSupported && track) {
      try {
        await track.applyConstraints({ advanced: [{ torch: true }] } as MediaTrackConstraints);
        torchOn = true;
      } catch {
        // Some devices advertise torch but refuse the constraint. Not fatal.
        torchOn = false;
      }
    }

    setState({
      active: true,
      torchSupported,
      torchOn,
      facingMode: (settings.facingMode as string) ?? null,
      width: settings.width ?? null,
      height: settings.height ?? null,
    });

    return stream;
  }, []);

  const setTorch = useCallback(async (on: boolean) => {
    const track = trackRef.current;
    if (!track || !trackSupportsTorch(track)) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on }] } as MediaTrackConstraints);
      setState((s) => ({ ...s, torchOn: on }));
      return true;
    } catch {
      return false;
    }
  }, []);

  const getStream = useCallback(() => streamRef.current, []);

  return { state, start, stop, setTorch, getStream };
}
