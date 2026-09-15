import type { AppError } from '../types/measurement';
import { AlertIcon } from './Icons';

interface ErrorPanelProps {
  error: AppError;
  onRetry?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}

export function ErrorPanel({ error, onRetry, secondaryLabel, onSecondary }: ErrorPanelProps) {
  return (
    <div className="vs-stack" role="alert">
      <div className="vs-alert vs-alert--bad">
        <span className="vs-alert__title">
          <AlertIcon size={18} /> {error.title}
        </span>
        <p className="vs-alert__body">{error.message}</p>
      </div>
      {onRetry && (
        <button type="button" className="vs-btn vs-btn--primary vs-btn--block" onClick={onRetry}>
          {error.action}
        </button>
      )}
      {onSecondary && secondaryLabel && (
        <button type="button" className="vs-btn vs-btn--ghost vs-btn--block" onClick={onSecondary}>
          {secondaryLabel}
        </button>
      )}
    </div>
  );
}
