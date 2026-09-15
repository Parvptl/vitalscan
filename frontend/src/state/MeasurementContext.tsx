/**
 * In-memory measurement store.
 *
 * Deliberately NOT persisted: no localStorage, no sessionStorage, no service
 * worker caching. Closing or reloading the tab discards the measurement, which
 * is the behaviour we want for health data on a shared device.
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AppError, CaptureMeta, FrameSignals, Measurement } from '../types/measurement';

export interface PendingCapture {
  signals: FrameSignals;
  meta: CaptureMeta;
}

interface MeasurementStore {
  pending: PendingCapture | null;
  result: Measurement | null;
  error: AppError | null;
  setPending: (capture: PendingCapture | null) => void;
  setResult: (result: Measurement | null) => void;
  setError: (error: AppError | null) => void;
  reset: () => void;
}

const MeasurementContext = createContext<MeasurementStore | null>(null);

export interface MeasurementProviderProps {
  children: ReactNode;
  /** Seed state. Used by tests to render a screen in a given state. */
  initial?: Partial<Pick<MeasurementStore, 'pending' | 'result' | 'error'>>;
}

export function MeasurementProvider({ children, initial }: MeasurementProviderProps) {
  const [pending, setPending] = useState<PendingCapture | null>(initial?.pending ?? null);
  const [result, setResult] = useState<Measurement | null>(initial?.result ?? null);
  const [error, setError] = useState<AppError | null>(initial?.error ?? null);

  const reset = useCallback(() => {
    setPending(null);
    setResult(null);
    setError(null);
  }, []);

  const value = useMemo<MeasurementStore>(
    () => ({ pending, result, error, setPending, setResult, setError, reset }),
    [pending, result, error, reset],
  );

  return <MeasurementContext.Provider value={value}>{children}</MeasurementContext.Provider>;
}

export function useMeasurementStore(): MeasurementStore {
  const store = useContext(MeasurementContext);
  if (!store) {
    throw new Error('useMeasurementStore must be used inside a MeasurementProvider');
  }
  return store;
}
