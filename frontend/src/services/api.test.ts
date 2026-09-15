import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, processMeasurement } from './api';
import type { FrameSignals } from '../types/measurement';

const SIGNALS: FrameSignals = {
  timestamps: [0, 0.033],
  gray: [100, 101],
  red: [200, 201],
  green: [50, 51],
  blue: [30, 31],
};

function jsonResponse(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function expectApiError(promise: Promise<unknown>) {
  return promise.then(
    () => {
      throw new Error('expected the request to reject');
    },
    (err: unknown) => {
      expect(err).toBeInstanceOf(ApiError);
      return (err as ApiError).appError;
    },
  );
}

describe('processMeasurement error handling', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns the parsed measurement on success', async () => {
    const measurement = {
      status: 'success',
      pulse_rate: { count_based: 72, ppi_based: 72, amdf_based: 71, fused: 72, peaks_detected: 36 },
      signal_quality: { label: 'Good' },
      waveform: { rppg: [0, 1, 0] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(200, measurement)),
    );
    const result = await processMeasurement(SIGNALS);
    expect(result.pulse_rate.fused).toBe(72);
  });

  it('maps HTTP 422 to an actionable message and surfaces the server reason', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(jsonResponse(422, { message: 'Only 8.0s of signal was captured.' })),
    );
    const error = await expectApiError(processMeasurement(SIGNALS));
    expect(error.code).toBe('PAYLOAD_REJECTED');
    expect(error.message).toContain('8.0s');
    expect(error.action).toBe('Measure again');
  });

  it('maps HTTP 400 to a rejected payload', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(400, {})));
    const error = await expectApiError(processMeasurement(SIGNALS));
    expect(error.code).toBe('PAYLOAD_REJECTED');
  });

  it('maps HTTP 413 to a size complaint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(413, {})));
    const error = await expectApiError(processMeasurement(SIGNALS));
    expect(error.code).toBe('PAYLOAD_REJECTED');
    expect(error.title).toMatch(/too large/i);
  });

  it('maps HTTP 500 to a processing failure without leaking server text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(500, { detail: 'Traceback (most recent call last): File "pipeline.py"' }),
      ),
    );
    const error = await expectApiError(processMeasurement(SIGNALS));
    expect(error.code).toBe('PROCESSING_FAILED');
    expect(error.message).not.toContain('Traceback');
  });

  it('maps a network failure to backend-unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const error = await expectApiError(processMeasurement(SIGNALS));
    expect(error.code).toBe('BACKEND_UNAVAILABLE');
    expect(error.message).toMatch(/connection/i);
  });

  it('maps an aborted request to a timeout', async () => {
    const abort = new DOMException('aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    const error = await expectApiError(processMeasurement(SIGNALS));
    expect(error.code).toBe('TIMEOUT');
  });

  it('rejects an incomplete 200 response rather than rendering partial results', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { status: 'success' })));
    const error = await expectApiError(processMeasurement(SIGNALS));
    expect(error.code).toBe('MALFORMED_RESPONSE');
  });

  it('rejects a response body that is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      } as unknown as Response),
    );
    const error = await expectApiError(processMeasurement(SIGNALS));
    expect(error.code).toBe('MALFORMED_RESPONSE');
  });
});
