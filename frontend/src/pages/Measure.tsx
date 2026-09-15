import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Disclaimer, PrivacyNote } from '../components/Disclaimer';
import { ErrorPanel } from '../components/ErrorPanel';
import { FlashIcon, FlashOffIcon } from '../components/Icons';
import { LiveWaveform } from '../components/LiveWaveform';
import { ProgressRing } from '../components/ProgressRing';
import { StatusPill, type StatusTone } from '../components/StatusPill';
import { MEASUREMENT_SECONDS, WAVEFORM_WINDOW_SECONDS } from '../config';
import { useMeasurementEngine } from '../hooks/useMeasurementEngine';
import { useMeasurementStore } from '../state/MeasurementContext';
import type { CaptureMeta, FrameSignals, PlacementState } from '../types/measurement';

const PLACEMENT_TONE: Record<PlacementState, StatusTone> = {
  NO_FINGER: 'neutral',
  DETECTING: 'neutral',
  FINGER_DETECTED: 'warn',
  SIGNAL_WEAK: 'warn',
  TOO_MUCH_MOVEMENT: 'warn',
  SIGNAL_GOOD: 'good',
  READY: 'good',
};

const PLACEMENT_LABEL: Record<PlacementState, string> = {
  NO_FINGER: 'No finger detected',
  DETECTING: 'Checking signal',
  FINGER_DETECTED: 'Finger detected',
  SIGNAL_WEAK: 'Signal weak',
  TOO_MUCH_MOVEMENT: 'Too much movement',
  SIGNAL_GOOD: 'Signal good',
  READY: 'Ready to measure',
};

function formatClock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  const m = String(Math.floor(whole / 60)).padStart(2, '0');
  const s = String(whole % 60).padStart(2, '0');
  return `${m}:${s}`;
}

export function Measure() {
  const navigate = useNavigate();
  const store = useMeasurementStore();
  const [permissionRequested, setPermissionRequested] = useState(false);

  const handleComplete = useCallback(
    (signals: FrameSignals, meta: CaptureMeta) => {
      store.setPending({ signals, meta });
      store.setResult(null);
      store.setError(null);
      navigate('/processing', { replace: true });
    },
    [navigate, store],
  );

  const engine = useMeasurementEngine({
    durationS: MEASUREMENT_SECONDS,
    onComplete: handleComplete,
  });
  const { snapshot } = engine;

  useEffect(() => {
    document.title = 'Measuring · VitalScan';
    return () => {
      document.title = 'VitalScan';
    };
  }, []);

  const measuring = snapshot.phase === 'MEASURING';
  const counting = snapshot.phase === 'COUNTDOWN';
  const cameraLive =
    snapshot.phase === 'FINGER_PLACEMENT' ||
    snapshot.phase === 'SIGNAL_CHECK' ||
    counting ||
    measuring;

  const tone = PLACEMENT_TONE[snapshot.placement];
  const viewportTone = measuring
    ? snapshot.quality === 'GOOD'
      ? 'good'
      : 'warn'
    : tone === 'good'
      ? 'good'
      : tone === 'warn'
        ? 'warn'
        : 'bad';

  const remaining = Math.max(0, MEASUREMENT_SECONDS - snapshot.elapsedS);

  const handleStartCamera = useCallback(async () => {
    setPermissionRequested(true);
    await engine.requestCamera();
  }, [engine]);

  const handleRetry = useCallback(async () => {
    store.reset();
    setPermissionRequested(false);
    window.location.reload();
  }, [store]);

  const torchControl = useMemo(() => {
    if (!cameraLive) return null;
    if (snapshot.torchSupported) {
      return (
        <button
          type="button"
          className="vs-btn vs-btn--ghost"
          onClick={() => engine.setTorch(!snapshot.torchOn)}
          aria-pressed={snapshot.torchOn}
          disabled={measuring || counting}
        >
          {snapshot.torchOn ? <FlashIcon size={18} /> : <FlashOffIcon size={18} />}
          Flash: {snapshot.torchOn ? 'ON' : 'OFF'}
        </button>
      );
    }
    return (
      <p className="vs-fine vs-center" style={{ maxWidth: 320 }}>
        <FlashOffIcon size={14} /> Your browser can't control the flash on this device. Please turn
        your phone's flashlight on manually and place your finger over the rear camera.
      </p>
    );
  }, [cameraLive, counting, engine, measuring, snapshot.torchOn, snapshot.torchSupported]);

  if (snapshot.phase === 'ERROR' && snapshot.error) {
    return (
      <div className="vs-page">
        <ErrorPanel
          error={snapshot.error}
          onRetry={handleRetry}
          secondaryLabel="Back to start"
          onSecondary={() => navigate('/')}
        />
        <div className="vs-spacer" />
        <Disclaimer />
      </div>
    );
  }

  if (!permissionRequested || snapshot.phase === 'CAMERA_PERMISSION') {
    return (
      <div className="vs-page">
        <section className="vs-stack vs-reveal" style={{ marginTop: 'clamp(8px, 4vh, 40px)' }}>
          <p className="vs-eyebrow">Step 1 of 2</p>
          <h1 className="vs-title">Allow camera access</h1>
          <p className="vs-subtitle">
            VitalScan uses your rear camera and flash to read the pulse in your fingertip. Nothing
            is recorded.
          </p>
        </section>

        <button
          type="button"
          className="vs-btn vs-btn--primary vs-btn--block"
          onClick={handleStartCamera}
        >
          Turn on camera
        </button>
        <button type="button" className="vs-btn vs-btn--ghost vs-btn--block" onClick={() => navigate('/instructions')}>
          Back to instructions
        </button>

        <PrivacyNote />
        <div className="vs-spacer" />
        <Disclaimer />
      </div>
    );
  }

  return (
    <div className="vs-page vs-page--flush">
      <div className="vs-measure">
        <div className="vs-stack vs-stack--tight vs-center">
          <p className="vs-eyebrow">{measuring ? 'Measuring' : 'Finger placement'}</p>
          <h1 className="vs-subtitle" style={{ color: 'var(--vs-ink)', fontWeight: 620 }}>
            {measuring ? 'Keep your finger steady' : 'Place finger over camera + flash'}
          </h1>
        </div>

        <div className={`vs-viewport vs-viewport--${viewportTone}`}>
          <video
            ref={engine.attachVideo}
            className="vs-viewport__video"
            playsInline
            muted
            aria-label="Camera preview"
          />
          <ProgressRing
            progress={measuring ? snapshot.progress : 0}
            tone={snapshot.quality === 'GOOD' ? 'good' : 'accent'}
          />
          {snapshot.placement === 'NO_FINGER' && !measuring && !counting && (
            <div className="vs-viewport__overlay">Cover the lens completely with your fingertip</div>
          )}
          {counting && (
            <div className="vs-viewport__countdown" aria-hidden="true">
              {snapshot.countdown}
            </div>
          )}
        </div>

        <div className="vs-measure__side vs-stack" style={{ width: '100%', maxWidth: 420 }}>
          <div className="vs-center">
            <StatusPill
              tone={measuring ? (snapshot.quality === 'GOOD' ? 'good' : 'warn') : tone}
              label={
                measuring ? `Signal ${snapshot.quality.toLowerCase()}` : PLACEMENT_LABEL[snapshot.placement]
              }
              live
            />
          </div>

          <p className="vs-center vs-body" aria-live="polite">
            {counting ? 'Starting in a moment - hold still.' : snapshot.hint}
          </p>

          {measuring && (
            <div className="vs-stack vs-stack--tight vs-center">
              <p className="vs-timer">
                {formatClock(snapshot.elapsedS)} / {formatClock(MEASUREMENT_SECONDS)}
              </p>
              <div
                className="vs-progress"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={MEASUREMENT_SECONDS}
                aria-valuenow={Math.round(snapshot.elapsedS)}
                aria-valuetext={`${Math.round(snapshot.elapsedS)} of ${MEASUREMENT_SECONDS} seconds`}
              >
                <div className="vs-progress__fill" style={{ width: `${snapshot.progress * 100}%` }} />
              </div>
              <p className="vs-fine">{Math.ceil(remaining)}s remaining</p>
            </div>
          )}

          <LiveWaveform
            getWindow={engine.getWaveWindow}
            fps={snapshot.effectiveFps}
            windowSeconds={WAVEFORM_WINDOW_SECONDS}
            active={measuring}
          />

          {!measuring && !counting && (
            <button
              type="button"
              className="vs-btn vs-btn--primary vs-btn--block"
              onClick={engine.beginCountdown}
              disabled={!engine.canStart}
            >
              {engine.canStart ? `Start ${MEASUREMENT_SECONDS}-second measurement` : 'Waiting for a steady signal'}
            </button>
          )}

          <div className="vs-center">{torchControl}</div>

          <button
            type="button"
            className="vs-btn vs-btn--ghost vs-btn--block"
            onClick={() => {
              engine.cancel();
              navigate('/instructions');
            }}
          >
            {measuring || counting ? 'Stop measurement' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}
