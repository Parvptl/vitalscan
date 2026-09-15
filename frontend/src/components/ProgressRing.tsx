interface ProgressRingProps {
  /** 0 to 1. */
  progress: number;
  tone?: 'accent' | 'good' | 'warn';
}

/** Circular progress track drawn around the camera viewport. */
export function ProgressRing({ progress, tone = 'accent' }: ProgressRingProps) {
  const radius = 49;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, progress));
  const color =
    tone === 'good' ? 'var(--vs-good)' : tone === 'warn' ? 'var(--vs-warn)' : 'var(--vs-accent)';

  return (
    <svg className="vs-viewport__ring" viewBox="0 0 100 100" aria-hidden="true">
      <circle cx="50" cy="50" r={radius} stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
      <circle
        cx="50"
        cy="50"
        r={radius}
        stroke={color}
        strokeWidth="2.6"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - clamped)}
        style={{ transition: 'stroke-dashoffset 220ms linear' }}
      />
    </svg>
  );
}
