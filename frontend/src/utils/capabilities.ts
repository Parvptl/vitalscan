/** Feature detection - nothing here assumes a capability exists. */

export interface Capabilities {
  mediaDevices: boolean;
  getUserMedia: boolean;
  secureContext: boolean;
  canvas: boolean;
  webWorker: boolean;
  videoFrameCallback: boolean;
}

export function detectCapabilities(): Capabilities {
  const nav = typeof navigator === 'undefined' ? undefined : navigator;
  return {
    mediaDevices: !!nav?.mediaDevices,
    getUserMedia: typeof nav?.mediaDevices?.getUserMedia === 'function',
    secureContext:
      typeof window === 'undefined' ||
      window.isSecureContext ||
      ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname),
    canvas:
      typeof document !== 'undefined' &&
      typeof document.createElement('canvas').getContext === 'function',
    webWorker: typeof Worker !== 'undefined',
    videoFrameCallback:
      typeof HTMLVideoElement !== 'undefined' &&
      'requestVideoFrameCallback' in HTMLVideoElement.prototype,
  };
}

export function cameraIsUsable(caps: Capabilities): boolean {
  return caps.mediaDevices && caps.getUserMedia && caps.canvas && caps.secureContext;
}

/** Torch (flashlight) support is read from the live track, never assumed. */
export function trackSupportsTorch(track: MediaStreamTrack | null | undefined): boolean {
  if (!track || typeof track.getCapabilities !== 'function') return false;
  try {
    const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
    return caps?.torch === true;
  } catch {
    return false;
  }
}
