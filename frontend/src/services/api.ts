/**
 * Backend client. Every failure path is mapped to a user-facing AppError with
 * a concrete recovery action - no raw server text and no Python tracebacks are
 * ever shown to the user.
 */

import type {
  AppError,
  CaptureMeta,
  FrameSignals,
  Measurement,
  ServerConfig,
} from '../types/measurement';

const RAW_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000';
export const API_BASE_URL = RAW_BASE.replace(/\/+$/, '');

const REQUEST_TIMEOUT_MS = Number(import.meta.env.VITE_API_TIMEOUT_MS ?? 45000);

export class ApiError extends Error {
  readonly appError: AppError;

  constructor(appError: AppError) {
    super(appError.message);
    this.name = 'ApiError';
    this.appError = appError;
  }
}

function error(
  code: AppError['code'],
  title: string,
  message: string,
  action = 'Try again',
): ApiError {
  return new ApiError({ code, title, message, action });
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') {
      throw error(
        'TIMEOUT',
        'Analysis timed out',
        'The server took too long to analyse your measurement. Please try once more.',
      );
    }
    throw error(
      'BACKEND_UNAVAILABLE',
      'Unable to process measurement',
      'We could not reach the analysis service. Check your connection and try again.',
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail = '';
    try {
      const body = await response.json();
      detail = body?.message ?? body?.detail ?? '';
      if (typeof detail !== 'string') detail = '';
    } catch {
      detail = '';
    }

    if (response.status === 413) {
      throw error(
        'PAYLOAD_REJECTED',
        'Measurement too large',
        'The captured signal was larger than the server accepts. Try a fresh measurement.',
        'Measure again',
      );
    }
    if (response.status === 400 || response.status === 422) {
      throw error(
        'PAYLOAD_REJECTED',
        'Measurement could not be analysed',
        detail ||
          'The captured signal was not usable. Keep your finger completely still over the camera and try again.',
        'Measure again',
      );
    }
    if (response.status >= 500) {
      throw error(
        'PROCESSING_FAILED',
        'Analysis failed',
        'Something went wrong while analysing your measurement. Please try again.',
        'Measure again',
      );
    }
    throw error(
      'PROCESSING_FAILED',
      'Analysis failed',
      detail || 'The analysis service returned an unexpected response.',
      'Measure again',
    );
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw error(
      'MALFORMED_RESPONSE',
      'Unexpected response',
      'The analysis service returned data we could not read. Please try again.',
    );
  }
}

function assertMeasurement(value: unknown): asserts value is Measurement {
  const m = value as Measurement | undefined;
  const ok =
    !!m &&
    m.status === 'success' &&
    !!m.pulse_rate &&
    typeof m.pulse_rate.count_based === 'number' &&
    !!m.signal_quality &&
    !!m.waveform &&
    Array.isArray(m.waveform.rppg);
  if (!ok) {
    throw error(
      'MALFORMED_RESPONSE',
      'Unexpected response',
      'The analysis result was incomplete, so we cannot show a reliable measurement.',
    );
  }
}

export async function getHealth(): Promise<{ status: string; version: string }> {
  return request('/api/health');
}

export async function getConfig(): Promise<ServerConfig> {
  return request('/api/config');
}

export async function processMeasurement(
  signals: FrameSignals,
  meta?: CaptureMeta,
): Promise<Measurement> {
  const result = await request<unknown>('/api/measurement/process', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signals, meta }),
  });
  assertMeasurement(result);
  return result;
}
