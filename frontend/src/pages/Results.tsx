import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Disclaimer } from '../components/Disclaimer';
import { DropletIcon, GaugeIcon, HeartIcon, LungsIcon, WaveIcon } from '../components/Icons';
import { MetricCard } from '../components/MetricCard';
import { StatusPill } from '../components/StatusPill';
import { useMeasurementStore } from '../state/MeasurementContext';

export function Results() {
  const navigate = useNavigate();
  const { result, reset } = useMeasurementStore();

  useEffect(() => {
    if (!result) navigate('/', { replace: true });
  }, [navigate, result]);

  if (!result) return null;

  const { pulse_rate, signal_quality, rhythm, spo2, perfusion_index, respiratory_rate } = result;
  const qualityGood = signal_quality.label === 'Good';
  const heroValue = pulse_rate.fused ?? pulse_rate.amdf_based;
  const heroIsFused = pulse_rate.fused !== null;

  return (
    <div className="vs-page vs-page--wide">
      <section className="vs-stack vs-center vs-stack--tight vs-reveal">
        <p className="vs-eyebrow">Measurement complete</p>
      </section>

      <section className="vs-hero vs-reveal vs-reveal--1">
        <span className="vs-hero__icon" aria-hidden="true">
          <HeartIcon size={32} />
        </span>
        <p className="vs-hero__value">
          {heroValue}
          <span className="vs-hero__unit"> BPM</span>
        </p>
        <p className="vs-hero__label">Pulse rate</p>
        <p className="vs-fine vs-center">
          {heroIsFused
            ? 'Fused from three independent estimators (count, pulse interval, AMDF).'
            : 'Fusion was inconclusive; showing the AMDF-based estimate only.'}
        </p>
      </section>

      <section
        className={`vs-card vs-card--lg vs-stack vs-stack--tight vs-reveal vs-reveal--2`}
        aria-labelledby="vs-quality-heading"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <h2 id="vs-quality-heading" className="vs-eyebrow">
            Signal quality
          </h2>
          <StatusPill tone={qualityGood ? 'good' : 'bad'} label={signal_quality.label.toUpperCase()} />
        </div>
        <ul className="vs-stack vs-stack--tight vs-fine" style={{ margin: 0, paddingLeft: 18 }}>
          <li>
            {signal_quality.good_segments} of {signal_quality.total_segments} ten-second segments
            passed the quality check.
          </li>
          <li>
            The three pulse-rate methods agreed to within {signal_quality.method_spread_bpm} bpm.
          </li>
          <li>{pulse_rate.peaks_detected} pulse peaks detected over {result.capture.duration_s}s.</li>
        </ul>
        {!qualityGood && (
          <div className="vs-alert vs-alert--warn" style={{ marginTop: 8 }}>
            <span className="vs-alert__title">This measurement may be unreliable</span>
            <p className="vs-alert__body">
              The signal-quality assessment flagged this recording. Measure again with your finger
              resting still and fully covering the camera and flash.
            </p>
          </div>
        )}
      </section>

      <section className="vs-grid vs-grid--tablet-3 vs-reveal vs-reveal--3" aria-label="Additional metrics">
        <MetricCard
          name="SpO₂"
          icon={<DropletIcon size={16} />}
          value={spo2 ? spo2.value.toFixed(1) : null}
          unit="%"
          experimental
          explanation="Blood oxygen estimate from the red/blue ratio-of-ratios of your fingertip. Camera-based, not oximeter-calibrated."
          unavailableReason="The colour signal did not contain a usable pulsatile component."
        />
        <MetricCard
          name="Respiratory rate"
          icon={<LungsIcon size={16} />}
          value={respiratory_rate ? respiratory_rate.value.toFixed(1) : null}
          unit="breaths/min"
          experimental
          explanation="Estimated from how your breathing modulates the size of each pulse beat."
          unavailableReason="Too few pulse peaks were detected to estimate a breathing rate."
        />
        <MetricCard
          name="Perfusion index"
          icon={<GaugeIcon size={16} />}
          value={perfusion_index ? perfusion_index.value.toFixed(2) : null}
          unit="%"
          experimental
          explanation="How strong the pulsatile blood flow was in your fingertip. Higher means a stronger signal."
          unavailableReason="The colour signal did not contain a usable pulsatile component."
        />
        <MetricCard
          name="Rhythm"
          icon={<WaveIcon size={16} />}
          value={rhythm.ppi_method}
          explanation={`From beat-to-beat interval variability. The per-segment AMDF check agreed: ${rhythm.amdf_method.toLowerCase()}.`}
        />
      </section>

      {result.notes.length > 0 && (
        <section className="vs-alert vs-alert--info">
          <span className="vs-alert__title">Notes from the analysis</span>
          <ul className="vs-alert__body" style={{ margin: 0, paddingLeft: 18 }}>
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <div className="vs-stack">
        <Link to="/results/details" className="vs-btn vs-btn--secondary vs-btn--block">
          View detailed analysis
        </Link>
        <button
          type="button"
          className="vs-btn vs-btn--primary vs-btn--block"
          onClick={() => {
            reset();
            navigate('/measure');
          }}
        >
          Measure again
        </button>
      </div>

      <Disclaimer />
    </div>
  );
}
