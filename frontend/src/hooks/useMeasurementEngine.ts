/**
 * The measurement state machine and camera sampling loop.
 *
 * PERFORMANCE CONTRACT
 * --------------------
 * Camera frames arrive at ~30 fps and are reduced to five numbers each
 * (notebook cell 9). That happens in `requestVideoFrameCallback` and writes
 * straight into typed arrays held in refs - it never touches React state, so
 * the component tree does not re-render per frame.
 *
 * React state is published on a slow timer (~5 Hz) with the few values the UI
 * actually shows: phase, placement state, elapsed seconds, live quality. The
 * live waveform reads the typed arrays directly from its own canvas rAF loop,
 * and the rolling cardiac-band analysis runs in a Web Worker.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppError,
  CaptureMeta,
  FrameSignals,
  MeasurementPhase,
  PlacementState,
} from '../types/measurement';
import { classifyPlacement, isCovered, liveQuality, type LiveQuality } from '../utils/fingerDetect';
import { reduceFrame, SignalRecorder, type FrameStats } from '../utils/frameStats';
import { detectCapabilities } from '../utils/capabilities';
import { useCamera } from './useCamera';

/** Notebook cell 4: RESIZE_FACTOR = 0.1 spatial downsample before averaging. */
const RESIZE_FACTOR = 0.1;
const MIN_ROI = 16;

/** Rolling window used for the live quality check, in seconds. */
const QUALITY_WINDOW_S = 6;
/** How often the worker re-evaluates the rolling window, in ms. */
const QUALITY_INTERVAL_MS = 500;
/** How often React state is refreshed, in ms. */
const UI_TICK_MS = 200;
/** Preview memory cap: keep only the last ~12 s while idling. */
const PREVIEW_MAX_SAMPLES = 12 * 60;

/** How long to wait for the first requestVideoFrameCallback before falling
 * back to requestAnimationFrame sampling. */
const RVFC_WATCHDOG_MS = 800;
/** If the preview is running but no frame has been read after this long, the
 * browser is not delivering frames and we say so rather than hanging. */
const CAPTURE_STALL_MS = 8000;

const COUNTDOWN_SECONDS = 3;
/** Sustained loss of finger contact that aborts an in-flight capture. */
const ABORT_AFTER_LOST_S = 1.5;
/** Sustained movement that aborts an in-flight capture. */
const ABORT_AFTER_MOVEMENT_S = 3.0;

export interface EngineSnapshot {
  phase: MeasurementPhase;
  placement: PlacementState;
  hint: string;
  quality: LiveQuality;
  elapsedS: number;
  countdown: number;
  progress: number;
  torchSupported: boolean;
  torchOn: boolean;
  facingMode: string | null;
  error: AppError | null;
  sampleCount: number;
  effectiveFps: number;
}

export interface MeasurementEngineOptions {
  durationS: number;
  onComplete: (signals: FrameSignals, meta: CaptureMeta) => void;
}

const INITIAL_SNAPSHOT: EngineSnapshot = {
  phase: 'CAMERA_PERMISSION',
  placement: 'NO_FINGER',
  hint: 'Cover the rear camera and flash completely with your fingertip.',
  quality: 'POOR',
  elapsedS: 0,
  countdown: 0,
  progress: 0,
  torchSupported: false,
  torchOn: false,
  facingMode: null,
  error: null,
  sampleCount: 0,
  effectiveFps: 0,
};

export function useMeasurementEngine({ durationS, onComplete }: MeasurementEngineOptions) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const recorder = useRef(new SignalRecorder());
  const workerRef = useRef<Worker | null>(null);

  const phaseRef = useRef<MeasurementPhase>('CAMERA_PERMISSION');
  const placementRef = useRef<PlacementState>('NO_FINGER');
  const hintRef = useRef(INITIAL_SNAPSHOT.hint);
  const qualityRef = useRef<LiveQuality>('POOR');
  const bandQualityRef = useRef<{ perfusionPct: number; bandPowerRatio: number } | null>(null);

  const lastStatsRef = useRef<FrameStats | null>(null);
  const frameJumpRef = useRef(0);
  const coveredSinceRef = useRef<number | null>(null);
  const goodSinceRef = useRef<number | null>(null);
  const lostSinceRef = useRef<number | null>(null);
  const movingSinceRef = useRef<number | null>(null);
  const captureStartRef = useRef(0);
  const countdownEndRef = useRef(0);
  const elapsedRef = useRef(0);
  const effectiveFpsRef = useRef(0);
  const rafHandleRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const usingRafRef = useRef(false);
  const previewStartedAtRef = useRef<number | null>(null);
  const lastSampleAtRef = useRef(0);
  const watchdogRef = useRef<number | null>(null);
  const lastMediaTimeRef = useRef(-1);

  // Destructured so the callbacks keep a stable identity across renders: the
  // camera must not be torn down and rebuilt every time the UI heartbeat
  // publishes a new snapshot.
  const { state: cameraState, start, stop, setTorch, enableTorch, getStream } = useCamera();
  const cameraStateRef = useRef(cameraState);
  cameraStateRef.current = cameraState;

  const [snapshot, setSnapshot] = useState<EngineSnapshot>(INITIAL_SNAPSHOT);
  const capabilities = useMemo(() => detectCapabilities(), []);

  const setPhase = useCallback((phase: MeasurementPhase) => {
    phaseRef.current = phase;
  }, []);

  const fail = useCallback(
    (error: AppError) => {
      phaseRef.current = 'ERROR';
      setSnapshot((s) => ({ ...s, phase: 'ERROR', error }));
    },
    [],
  );

  // ---------------------------------------------------------------- sampling
  const sampleFrame = useCallback((mediaTimeS: number) => {
    const video = videoRef.current;
    const ctx = ctxRef.current;
    const canvas = canvasRef.current;
    if (!video || !ctx || !canvas || video.readyState < 2) return;

    if (canvas.width === 0 || canvas.height === 0) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const stats = reduceFrame(image.data);

    const previous = lastStatsRef.current;
    frameJumpRef.current = previous ? Math.abs(stats.gray - previous.gray) : 0;
    lastStatsRef.current = stats;

    const now = performance.now();
    const covered = isCovered(stats);
    if (covered) {
      if (coveredSinceRef.current === null) coveredSinceRef.current = now;
      lostSinceRef.current = null;
    } else {
      coveredSinceRef.current = null;
      bandQualityRef.current = null;
      if (lostSinceRef.current === null) lostSinceRef.current = now;
    }

    const rec = recorder.current;
    rec.push(mediaTimeS, stats);

    const phase = phaseRef.current;
    if (phase !== 'MEASURING' && phase !== 'COUNTDOWN') {
      rec.trimTo(PREVIEW_MAX_SAMPLES);
    }

    lastSampleAtRef.current = now;
    const duration = rec.durationS();
    if (duration > 0) effectiveFpsRef.current = (rec.size - 1) / duration;
  }, []);

  const startFrameLoop = useCallback(
    (video: HTMLVideoElement) => {
      cancelledRef.current = false;
      lastMediaTimeRef.current = -1;

      /**
       * Animation-frame sampling, used by browsers without
       * requestVideoFrameCallback (e.g. Firefox) and as the fallback when
       * rVFC turns out not to deliver frames. rAF can tick faster than the
       * camera, so repeated media times are skipped - otherwise the effective
       * frame rate would be over-reported.
       */
      const startRaf = () => {
        usingRafRef.current = true;
        const step = () => {
          if (cancelledRef.current) return;
          const t = video.currentTime;
          if (t > lastMediaTimeRef.current) {
            lastMediaTimeRef.current = t;
            sampleFrame(t);
          }
          rafHandleRef.current = requestAnimationFrame(step);
        };
        rafHandleRef.current = requestAnimationFrame(step);
      };

      if (capabilities.videoFrameCallback) {
        usingRafRef.current = false;
        type VideoFrameMeta = { mediaTime: number };
        const el = video as HTMLVideoElement & {
          requestVideoFrameCallback: (cb: (now: number, meta: VideoFrameMeta) => void) => number;
          cancelVideoFrameCallback: (handle: number) => void;
        };
        let fired = false;
        const step = (_now: number, meta: VideoFrameMeta) => {
          fired = true;
          if (cancelledRef.current) return;
          lastMediaTimeRef.current = meta.mediaTime;
          sampleFrame(meta.mediaTime);
          rafHandleRef.current = el.requestVideoFrameCallback(step);
        };
        rafHandleRef.current = el.requestVideoFrameCallback(step);

        // Some embedded and headless browsers expose requestVideoFrameCallback
        // but never invoke it. Without this watchdog the capture would sit at
        // zero samples forever, so fall back to rAF if no frame arrives.
        watchdogRef.current = window.setTimeout(() => {
          watchdogRef.current = null;
          if (fired || cancelledRef.current) return;
          const handle = rafHandleRef.current;
          if (handle !== null && el.cancelVideoFrameCallback) el.cancelVideoFrameCallback(handle);
          rafHandleRef.current = null;
          startRaf();
        }, RVFC_WATCHDOG_MS);
        return;
      }

      startRaf();
    },
    [capabilities.videoFrameCallback, sampleFrame],
  );

  const stopFrameLoop = useCallback(() => {
    cancelledRef.current = true;
    if (watchdogRef.current !== null) {
      window.clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
    const handle = rafHandleRef.current;
    if (handle !== null) {
      const video = videoRef.current as
        | (HTMLVideoElement & { cancelVideoFrameCallback?: (h: number) => void })
        | null;
      if (!usingRafRef.current && video?.cancelVideoFrameCallback) {
        video.cancelVideoFrameCallback(handle);
      } else {
        cancelAnimationFrame(handle);
      }
      rafHandleRef.current = null;
    }
  }, []);

  // ------------------------------------------------------------------ camera
  const beginPreview = useCallback(
    async (video: HTMLVideoElement) => {
      const stream = getStream();
      if (!stream) return;
      if (video.srcObject !== stream) {
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        video.muted = true;
        await video.play().catch(() => undefined);
        // Second attempt at the torch. Android Chrome frequently only exposes
        // `torch` in the track capabilities once the preview is actually
        // rendering, so the attempt made at permission time can come too early.
        // No-ops if the torch is already lit.
        void enableTorch();
      }

      const width = video.videoWidth || 640;
      const height = video.videoHeight || 480;
      const canvas = canvasRef.current ?? document.createElement('canvas');
      canvas.width = Math.max(MIN_ROI, Math.round(width * RESIZE_FACTOR));
      canvas.height = Math.max(MIN_ROI, Math.round(height * RESIZE_FACTOR));
      canvasRef.current = canvas;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        fail({
          code: 'CAMERA_UNSUPPORTED',
          title: 'Canvas unavailable',
          message: 'This browser could not create the drawing surface VitalScan needs.',
          action: 'Back to start',
        });
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctxRef.current = ctx;

      recorder.current.reset();
      lastStatsRef.current = null;
      bandQualityRef.current = null;
      stopFrameLoop();
      previewStartedAtRef.current = performance.now();
      lastSampleAtRef.current = 0;
      if (phaseRef.current === 'CAMERA_READY') setPhase('FINGER_PLACEMENT');
      startFrameLoop(video);
    },
    [getStream, enableTorch, fail, setPhase, startFrameLoop, stopFrameLoop],
  );

  /**
   * Acquire the stream, then start the preview.
   *
   * The preview element is attached separately via `attachVideo`, so the video
   * tag can live anywhere in the tree and be re-mounted (e.g. when the
   * permission screen gives way to the measurement screen) without losing the
   * stream or the sampling loop. Either order works: whichever of the two
   * happens second starts the preview.
   */
  const requestCamera = useCallback(async () => {
    try {
      await start();
      setPhase('CAMERA_READY');
      setSnapshot((s) => ({ ...s, phase: 'CAMERA_READY', error: null }));
      const video = videoRef.current;
      if (video) await beginPreview(video);
    } catch (err) {
      fail(err as AppError);
    }
  }, [beginPreview, start, fail, setPhase]);

  /** Ref callback for the preview <video>. Re-attaches on every mount. */
  const attachVideo = useCallback(
    (video: HTMLVideoElement | null) => {
      videoRef.current = video;
      if (!video) return;
      if (video.readyState >= 1) {
        void beginPreview(video);
        return;
      }
      video.onloadedmetadata = () => {
        void beginPreview(video);
      };
      void beginPreview(video);
    },
    [beginPreview],
  );

  const stopCamera = useCallback(() => {
    stopFrameLoop();
    const video = videoRef.current;
    if (video) video.srcObject = null;
    stop();
  }, [stop, stopFrameLoop]);

  // ------------------------------------------------------------------ worker
  useEffect(() => {
    if (!capabilities.webWorker) return undefined;
    const worker = new Worker(new URL('../workers/signalQuality.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<{ perfusionPct: number; bandPowerRatio: number }>) => {
      bandQualityRef.current = event.data;
    };
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [capabilities.webWorker]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const worker = workerRef.current;
      const rec = recorder.current;
      const fps = effectiveFpsRef.current;
      if (!worker || fps <= 0) return;
      const window = Math.round(QUALITY_WINDOW_S * fps);
      if (rec.size < Math.min(window, 32)) return;
      const samples = rec.tailGray(window);
      worker.postMessage({ samples, fps }, [samples.buffer]);
    }, QUALITY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  // ------------------------------------------------------------- UI heartbeat
  const completeRef = useRef(onComplete);
  completeRef.current = onComplete;

  const finishCapture = useCallback(() => {
    stopFrameLoop();
    setPhase('PROCESSING');
    const rec = recorder.current;
    const signals = rec.toPayload();
    const cam = cameraStateRef.current;
    const meta: CaptureMeta = {
      torch_enabled: cam.torchOn,
      facing_mode: cam.facingMode ?? undefined,
      frame_width: cam.width ?? undefined,
      frame_height: cam.height ?? undefined,
      roi_width: canvasRef.current?.width,
      roi_height: canvasRef.current?.height,
    };
    // Release the camera before handing off - nothing more needs to be seen.
    stopCamera();
    completeRef.current(signals, meta);
  }, [setPhase, stopCamera, stopFrameLoop]);

  useEffect(() => {
    const id = window.setInterval(() => {
      const phase = phaseRef.current;
      const now = performance.now();
      const stats = lastStatsRef.current;

      if (phase === 'FINGER_PLACEMENT' || phase === 'SIGNAL_CHECK') {
        // The camera reports as running but frames have stopped arriving (or
        // never arrived at all).
        const startedAt = previewStartedAtRef.current;
        const lastActivity = startedAt === null ? null : Math.max(startedAt, lastSampleAtRef.current);
        if (lastActivity !== null && now - lastActivity > CAPTURE_STALL_MS) {
          stopFrameLoop();
          stopCamera();
          fail({
            code: 'CAMERA_UNAVAILABLE',
            title: 'No camera frames received',
            message:
              'The camera started but this browser is not delivering video frames we can read. Try the latest Chrome, Edge or Safari on a phone.',
            action: 'Try again',
          });
          return;
        }

        if (stats) {
          const coveredForS = coveredSinceRef.current ? (now - coveredSinceRef.current) / 1000 : 0;
          const goodForS = goodSinceRef.current ? (now - goodSinceRef.current) / 1000 : 0;
          const verdict = classifyPlacement({
            stats,
            frameJump: frameJumpRef.current,
            coveredForS,
            quality: bandQualityRef.current,
            goodForS,
          });

          if (verdict.state === 'SIGNAL_GOOD' || verdict.state === 'READY') {
            if (goodSinceRef.current === null) goodSinceRef.current = now;
          } else {
            goodSinceRef.current = null;
          }

          placementRef.current = verdict.state;
          hintRef.current = verdict.hint;
          qualityRef.current = liveQuality(
            bandQualityRef.current,
            verdict.state === 'TOO_MUCH_MOVEMENT',
          );
          if (verdict.state !== 'NO_FINGER' && phaseRef.current === 'FINGER_PLACEMENT') {
            phaseRef.current = 'SIGNAL_CHECK';
          }
          if (verdict.state === 'NO_FINGER' && phaseRef.current === 'SIGNAL_CHECK') {
            phaseRef.current = 'FINGER_PLACEMENT';
          }
        }
      }

      if (phase === 'COUNTDOWN') {
        const remaining = Math.ceil((countdownEndRef.current - now) / 1000);
        if (remaining <= 0) {
          recorder.current.reset();
          lastStatsRef.current = null;
          captureStartRef.current = now;
          lostSinceRef.current = null;
          movingSinceRef.current = null;
          phaseRef.current = 'MEASURING';
        }
      }

      if (phase === 'MEASURING') {
        elapsedRef.current = (now - captureStartRef.current) / 1000;

        const lost = lostSinceRef.current ? (now - lostSinceRef.current) / 1000 : 0;
        if (lost > ABORT_AFTER_LOST_S) {
          stopFrameLoop();
          stopCamera();
          fail({
            code: 'FINGER_LOST',
            title: 'Finger not detected',
            message:
              'We lost contact with your fingertip during the measurement. Cover the camera and flash completely, then start again.',
            action: 'Measure again',
          });
          return;
        }

        const moving = frameJumpRef.current > 6;
        if (moving) {
          if (movingSinceRef.current === null) movingSinceRef.current = now;
        } else {
          movingSinceRef.current = null;
        }
        const movingForS = movingSinceRef.current ? (now - movingSinceRef.current) / 1000 : 0;
        if (movingForS > ABORT_AFTER_MOVEMENT_S) {
          stopFrameLoop();
          stopCamera();
          fail({
            code: 'TOO_MUCH_MOVEMENT',
            title: 'Too much movement',
            message:
              'Your finger moved too much for a reliable reading. Rest your hand on a surface and try again.',
            action: 'Measure again',
          });
          return;
        }

        qualityRef.current = liveQuality(bandQualityRef.current, moving);
        placementRef.current = moving ? 'TOO_MUCH_MOVEMENT' : 'SIGNAL_GOOD';
        hintRef.current = moving ? 'Keep your finger still.' : 'Keep your finger steady.';

        if (elapsedRef.current >= durationS) {
          finishCapture();
          return;
        }
      }

      const countdown =
        phaseRef.current === 'COUNTDOWN'
          ? Math.max(0, Math.ceil((countdownEndRef.current - now) / 1000))
          : 0;
      const elapsed = phaseRef.current === 'MEASURING' ? elapsedRef.current : 0;

      setSnapshot((prev) => {
        const next: EngineSnapshot = {
          phase: phaseRef.current,
          placement: placementRef.current,
          hint: hintRef.current,
          quality: qualityRef.current,
          elapsedS: Math.min(elapsed, durationS),
          countdown,
          progress: Math.min(1, elapsed / durationS),
          torchSupported: cameraStateRef.current.torchSupported,
          torchOn: cameraStateRef.current.torchOn,
          facingMode: cameraStateRef.current.facingMode,
          error: prev.error,
          sampleCount: recorder.current.size,
          effectiveFps: effectiveFpsRef.current,
        };
        const unchanged =
          prev.phase === next.phase &&
          prev.placement === next.placement &&
          prev.quality === next.quality &&
          prev.countdown === next.countdown &&
          Math.abs(prev.elapsedS - next.elapsedS) < 0.05 &&
          prev.torchSupported === next.torchSupported &&
          prev.torchOn === next.torchOn;
        return unchanged ? prev : next;
      });
    }, UI_TICK_MS);

    return () => window.clearInterval(id);
  }, [durationS, fail, finishCapture, stopCamera, stopFrameLoop]);

  // -------------------------------------------------------------- public API
  const beginCountdown = useCallback(() => {
    if (phaseRef.current !== 'SIGNAL_CHECK' && phaseRef.current !== 'FINGER_PLACEMENT') return;
    countdownEndRef.current = performance.now() + COUNTDOWN_SECONDS * 1000;
    phaseRef.current = 'COUNTDOWN';
  }, []);

  const cancel = useCallback(() => {
    stopFrameLoop();
    stopCamera();
    recorder.current.reset();
    previewStartedAtRef.current = null;
    phaseRef.current = 'CAMERA_PERMISSION';
  }, [stopCamera, stopFrameLoop]);

  useEffect(() => stopCamera, [stopCamera]);

  /** Live waveform source - read directly by the canvas, no React involved. */
  const getWaveWindow = useCallback((sampleCount: number) => recorder.current.tailGray(sampleCount), []);

  return {
    attachVideo,
    snapshot,
    capabilities,
    requestCamera,
    stopCamera,
    beginCountdown,
    cancel,
    setTorch,
    getWaveWindow,
    canStart: snapshot.placement === 'READY',
  };
}
