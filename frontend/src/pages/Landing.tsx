import { Link } from 'react-router-dom';
import { Disclaimer } from '../components/Disclaimer';
import { ArrowRightIcon, DropletIcon, HeartIcon, LungsIcon, WaveIcon } from '../components/Icons';
import { MEASUREMENT_SECONDS } from '../config';

const METRICS = [
  { icon: <HeartIcon size={18} />, label: 'Pulse rate' },
  { icon: <LungsIcon size={18} />, label: 'Respiratory rate' },
  { icon: <DropletIcon size={18} />, label: 'SpO₂ estimate' },
  { icon: <WaveIcon size={18} />, label: 'Rhythm & signal quality' },
];

export function Landing() {
  return (
    <div className="vs-page">
      <section className="vs-stack vs-reveal" style={{ marginTop: 'clamp(16px, 6vh, 56px)' }}>
        <p className="vs-eyebrow">Camera-based measurement</p>
        <h1 className="vs-title">
          Measure your vital signals
          <br />
          with your phone camera.
        </h1>
        <p className="vs-subtitle">
          Rest a fingertip on the rear camera for {MEASUREMENT_SECONDS} seconds. VitalScan reads the
          tiny colour changes your pulse makes in your fingertip and turns them into readings.
        </p>
      </section>

      <div className="vs-stack vs-reveal vs-reveal--1">
        <Link to="/instructions" className="vs-btn vs-btn--primary vs-btn--block">
          Start measurement
          <ArrowRightIcon size={18} />
        </Link>
        <Link to="/instructions" className="vs-btn vs-btn--ghost vs-btn--block">
          See how it works
        </Link>
      </div>

      <section className="vs-card vs-card--lg vs-stack vs-reveal vs-reveal--2">
        <h2 className="vs-eyebrow">What you'll get</h2>
        <ul className="vs-stack vs-stack--tight" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {METRICS.map((m) => (
            <li
              key={m.label}
              style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--vs-ink-muted)' }}
            >
              <span style={{ color: 'var(--vs-accent)' }}>{m.icon}</span>
              {m.label}
            </li>
          ))}
        </ul>
      </section>

      <div className="vs-spacer" />
      <Disclaimer />
    </div>
  );
}
