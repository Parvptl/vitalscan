/**
 * Status indicator.
 *
 * Accessibility: the tone is never carried by colour alone - each tone also
 * has a distinct glyph and the label text itself states the status.
 */

export type StatusTone = 'good' | 'warn' | 'bad' | 'neutral';

const GLYPH: Record<StatusTone, string> = {
  good: '✓',
  warn: '!',
  bad: '×',
  neutral: '•',
};

interface StatusPillProps {
  tone: StatusTone;
  label: string;
  live?: boolean;
}

export function StatusPill({ tone, label, live = false }: StatusPillProps) {
  return (
    <span
      className={`vs-pill vs-pill--${tone}`}
      role={live ? 'status' : undefined}
      aria-live={live ? 'polite' : undefined}
    >
      <span className="vs-pill__glyph" aria-hidden="true">
        {GLYPH[tone]}
      </span>
      {label}
    </span>
  );
}
