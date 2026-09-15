import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Disclaimer } from '../components/Disclaimer';
import { ErrorPanel } from '../components/ErrorPanel';
import { CheckIcon } from '../components/Icons';
import { ApiError, processMeasurement } from '../services/api';
import { useMeasurementStore } from '../state/MeasurementContext';
import type { AppError, Measurement } from '../types/measurement';

type StageState = 'pending' | 'active' | 'done';

interface Stage {
  id: string;
  label: string;
  /** Resolved from the actual response - never from a timer. */
  satisfiedBy: (result: Measurement) => boolean;
}

const STAGES: Stage[] = [
  { id: 'signal', label: 'Signal extracted', satisfiedBy: (r) => r.waveform.rppg.length > 0 },
  { id: 'peaks', label: 'Pulse peaks detected', satisfiedBy: (r) => r.pulse_rate.peaks_detected > 0 },
  {
    id: 'rate',
    label: 'Pulse rate estimated (count, PPI, AMDF)',
    satisfiedBy: (r) => Number.isFinite(r.pulse_rate.amdf_based),
  },
  { id: 'quality', label: 'Signal quality assessed', satisfiedBy: (r) => !!r.signal_quality },
  {
    id: 'params',
    label: 'Physiological parameters calculated',
    satisfiedBy: (r) => !!r.spo2 || !!r.respiratory_rate || !!r.perfusion_index,
  },
];

export function Processing() {
  const navigate = useNavigate();
  const store = useMeasurementStore();
  const [error, setError] = useState<AppError | null>(null);
  const [completed, setCompleted] = useState<Record<string, boolean>>({});
  const [uploaded, setUploaded] = useState(false);
  const started = useRef(false);

  // The store's identity changes whenever any part of it updates. Snapshot it
  // in refs so the request effect runs exactly once, for the capture that was
  // present when this screen mounted.
  const storeRef = useRef(store);
  storeRef.current = store;
  const captureRef = useRef(store.pending);

  useEffect(() => {
    const capture = captureRef.current;
    const store = storeRef.current;
    if (!capture) {
      navigate('/', { replace: true });
      return;
    }
    if (started.current) return;
    started.current = true;

    let cancelled = false;
    setUploaded(true);

    processMeasurement(capture.signals, capture.meta)
      .then((result) => {
        if (cancelled) return;
        const flags: Record<string, boolean> = {};
        STAGES.forEach((stage) => {
          flags[stage.id] = stage.satisfiedBy(result);
        });
        setCompleted(flags);
        store.setResult(result);
        // Drop the raw capture as soon as it has been analysed.
        store.setPending(null);
        window.setTimeout(() => {
          if (!cancelled) navigate('/results', { replace: true });
        }, 450);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const appError: AppError =
          err instanceof ApiError
            ? err.appError
            : {
                code: 'PROCESSING_FAILED',
                title: 'Unable to process measurement',
                message: 'Check your connection and try again.',
                action: 'Measure again',
              };
        store.setPending(null);
        setError(appError);
      });

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  if (error) {
    return (
      <div className="vs-page">
        <ErrorPanel
          error={error}
          onRetry={() => {
            store.reset();
            navigate('/measure', { replace: true });
          }}
          secondaryLabel="Back to start"
          onSecondary={() => {
            store.reset();
            navigate('/', { replace: true });
          }}
        />
        <div className="vs-spacer" />
        <Disclaimer />
      </div>
    );
  }

  const stageState = (stage: Stage, index: number): StageState => {
    if (completed[stage.id]) return 'done';
    const firstPending = STAGES.findIndex((s) => !completed[s.id]);
    if (uploaded && index === firstPending) return 'active';
    return 'pending';
  };

  return (
    <div className="vs-page">
      <section className="vs-stack vs-center vs-reveal" style={{ marginTop: 'clamp(16px, 8vh, 64px)' }}>
        <div style={{ display: 'grid', placeItems: 'center' }}>
          <div className="vs-spinner" role="status" aria-label="Analysing your measurement" />
        </div>
        <h1 className="vs-title" style={{ fontSize: 'var(--vs-text-2xl)' }}>
          Analysing your measurement…
        </h1>
        <p className="vs-body">This usually takes a few seconds.</p>
      </section>

      <ul className="vs-checklist vs-card vs-card--lg">
        {STAGES.map((stage, index) => {
          const state = stageState(stage, index);
          return (
            <li key={stage.id} className="vs-checklist__item" data-state={state}>
              <span className="vs-checklist__mark" aria-hidden="true">
                {state === 'done' ? <CheckIcon size={12} /> : ''}
              </span>
              <span>{stage.label}</span>
              <span className="vs-visually-hidden">
                {state === 'done' ? 'complete' : state === 'active' ? 'in progress' : 'waiting'}
              </span>
            </li>
          );
        })}
      </ul>

      <div className="vs-spacer" />
      <Disclaimer />
    </div>
  );
}
