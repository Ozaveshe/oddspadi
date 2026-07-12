import { clampProbability, formatPercent } from "@/lib/sports/prediction/format";

export function ProbabilityBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(clampProbability(value) * 100);
  const width = `${percent}%`;

  return (
    <div className="probability">
      <div className="row-between small">
        <strong>{label}</strong>
        <span>{formatPercent(value)}</span>
      </div>
      <div
        className="probability-track"
        role="progressbar"
        aria-label={label}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="probability-fill" style={{ width }} />
      </div>
    </div>
  );
}
