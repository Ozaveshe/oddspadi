import { formatPercent } from "@/lib/sports/prediction/format";

export function ProbabilityBar({ label, value }: { label: string; value: number }) {
  const width = `${Math.round(value * 100)}%`;

  return (
    <div className="probability">
      <div className="row-between small">
        <strong>{label}</strong>
        <span>{formatPercent(value)}</span>
      </div>
      <div className="probability-track" aria-hidden="true">
        <div className="probability-fill" style={{ width }} />
      </div>
    </div>
  );
}
