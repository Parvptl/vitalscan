import { Link } from 'react-router-dom';
import { Disclaimer, PrivacyNote } from '../components/Disclaimer';
import { ArrowRightIcon, FingerIcon, FlashIcon } from '../components/Icons';
import { MEASUREMENT_SECONDS } from '../config';

const STEPS = [
  'Sit comfortably and rest your hand on a table so it stays still.',
  'Place your fingertip flat over the rear camera lens.',
  'Make sure the flash light shines through your finger.',
  'Keep your finger still and breathe normally.',
  `Hold for about ${MEASUREMENT_SECONDS} seconds while we read your pulse.`,
];

const TIPS = [
  'Cover the lens completely - no gaps of light.',
  'Rest your finger gently; pressing hard squeezes the blood out.',
  'Warm hands give a stronger signal than cold ones.',
  'Avoid talking or moving during the measurement.',
];

export function Instructions() {
  return (
    <div className="vs-page">
      <section className="vs-stack vs-reveal">
        <p className="vs-eyebrow">Before you start</p>
        <h1 className="vs-title">How to measure</h1>
      </section>

      <ol className="vs-steps vs-card vs-card--lg vs-reveal vs-reveal--1">
        {STEPS.map((step, index) => (
          <li key={step} className="vs-steps__item">
            <span className="vs-steps__num" aria-hidden="true">
              {index + 1}
            </span>
            <span className="vs-body" style={{ color: 'var(--vs-ink)' }}>
              {step}
            </span>
          </li>
        ))}
      </ol>

      <section className="vs-card vs-stack vs-reveal vs-reveal--2">
        <h2 className="vs-eyebrow">
          <FingerIcon size={16} /> Tips for a good reading
        </h2>
        <ul className="vs-stack vs-stack--tight" style={{ margin: 0, paddingLeft: 18 }}>
          {TIPS.map((tip) => (
            <li key={tip} className="vs-fine" style={{ color: 'var(--vs-ink-muted)' }}>
              {tip}
            </li>
          ))}
        </ul>
      </section>

      <div className="vs-alert vs-alert--info vs-reveal vs-reveal--3">
        <span className="vs-alert__title">
          <FlashIcon size={16} /> About the flashlight
        </span>
        <p className="vs-alert__body">
          VitalScan turns the flash on automatically when your browser allows it. If it can't, we'll
          ask you to switch your phone's flashlight on yourself - the measurement works either way.
        </p>
      </div>

      <div className="vs-stack">
        <Link to="/measure" className="vs-btn vs-btn--primary vs-btn--block">
          Continue
          <ArrowRightIcon size={18} />
        </Link>
        <Link to="/" className="vs-btn vs-btn--ghost vs-btn--block">
          Back
        </Link>
      </div>

      <PrivacyNote />
      <Disclaimer />
    </div>
  );
}
