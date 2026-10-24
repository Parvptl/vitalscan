/**
 * Measurement processing strategy.
 *
 * Two builds, two paths:
 *   - web  (default)        -> POST to the FastAPI backend on Render
 *   - android (`local`)     -> run the ported pipeline on the device
 *
 * Selected by `VITE_PROCESSING_MODE` at build time, with a runtime fallback
 * that detects a Capacitor native shell. Both paths return the identical
 * `Measurement` shape, so every screen downstream is unchanged.
 */

import { ApiError, processMeasurement } from './api';
import type { AppError, CaptureMeta, FrameSignals, Measurement } from '../types/measurement';

export type ProcessingMode = 'local' | 'remote';

function detectNativeShell(): boolean {
  if (typeof window === 'undefined') return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try {
    return cap?.isNativePlatform?.() === true;
  } catch {
    return false;
  }
}

export function processingMode(): ProcessingMode {
  const configured = import.meta.env.VITE_PROCESSING_MODE;
  if (configured === 'local' || configured === 'remote') return configured;
  return detectNativeShell() ? 'local' : 'remote';
}

/** True when measurements never leave the device. */
export function isOfflineCapable(): boolean {
  return processingMode() === 'local';
}

function localFailure(message: string): ApiError {
  const appError: AppError = {
    code: 'PAYLOAD_REJECTED',
    title: 'Measurement could not be analysed',
    message,
    action: 'Measure again',
  };
  return new ApiError(appError);
}

/**
 * Analyse a capture using whichever strategy this build targets.
 *
 * Errors are normalised to `ApiError` so the existing screens handle local and
 * remote failures identically.
 */
export async function analyseMeasurement(
  signals: FrameSignals,
  meta?: CaptureMeta,
): Promise<Measurement> {
  if (processingMode() === 'remote') {
    return processMeasurement(signals, meta);
  }

  // Local analysis is CPU-bound but short (tens of milliseconds for a 30 s
  // capture). Yield to the event loop first so the processing screen paints
  // before the main thread is occupied.
  await new Promise((resolve) => setTimeout(resolve, 0));

  // Dynamically imported so the web build, which never runs it, does not ship
  // the algorithm port and its coefficient tables in the main bundle.
  const [{ runLocalPipeline }, { PipelineError }] = await Promise.all([
    import('../algorithms/localPipeline'),
    import('../algorithms/stages'),
  ]);

  try {
    return runLocalPipeline(signals, meta);
  } catch (err) {
    if (err instanceof PipelineError) throw localFailure(err.message);
    throw new ApiError({
      code: 'PROCESSING_FAILED',
      title: 'Analysis failed',
      message: 'Something went wrong while analysing your measurement. Please try again.',
      action: 'Measure again',
    });
  }
}
