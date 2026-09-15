import type { ReactNode } from 'react';

/**
 * A single result metric.
 *
 * When `value` is null the card renders an explicit unavailable state. It never
 * substitutes a zero or a plausible-looking placeholder.
 */
interface MetricCardProps {
  name: string;
  icon?: ReactNode;
  value: string | null;
  unit?: string;
  explanation: string;
  experimental?: boolean;
  unavailableReason?: string;
}

export function MetricCard({
  name,
  icon,
  value,
  unit,
  explanation,
  experimental = false,
  unavailableReason,
}: MetricCardProps) {
  const available = value !== null;

  return (
    <div className="vs-card vs-metric">
      <div className="vs-metric__head">
        <span className="vs-metric__name">
          {icon}
          {name}
        </span>
        {experimental && <span className="vs-tag">Experimental</span>}
      </div>

      {available ? (
        <p className="vs-metric__value">
          {value}
          {unit && <span className="vs-metric__unit">{unit}</span>}
        </p>
      ) : (
        <p className="vs-metric__value vs-metric__value--unavailable">Not available</p>
      )}

      <p className="vs-metric__note">
        {available ? explanation : (unavailableReason ?? 'This value could not be calculated from your measurement.')}
      </p>
    </div>
  );
}
