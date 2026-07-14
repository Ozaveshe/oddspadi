import { clampProbability, formatPercent } from "@/lib/sports/prediction/format";

type ProbabilitySelection = {
  id: "home" | "draw" | "away";
  label: string;
  value: number;
};

export function ProbabilityDistribution({
  selections,
  dataQuality
}: {
  selections: ProbabilitySelection[];
  dataQuality: number;
}) {
  const normalized = selections.map((selection) => ({
    ...selection,
    value: clampProbability(selection.value),
    percent: Math.round(clampProbability(selection.value) * 100)
  }));
  const accessibleSummary = normalized.map((selection) => `${selection.label} ${formatPercent(selection.value)}`).join(", ");
  const qualityPercent = Math.round(clampProbability(dataQuality) * 100);

  return (
    <figure className="probability-distribution">
      <div
        className="probability-distribution-track"
        role="img"
        aria-label={`Model probability distribution: ${accessibleSummary}`}
      >
        {normalized.map((selection) => (
          <span
            className={`probability-distribution-segment segment-${selection.id}`}
            style={{ width: `${selection.value * 100}%` }}
            key={selection.id}
          />
        ))}
      </div>
      <figcaption>
        <dl className="probability-distribution-legend">
          {normalized.map((selection) => (
            <div key={selection.id}>
              <dt><span className={`probability-dot dot-${selection.id}`} />{selection.label}</dt>
              <dd>{formatPercent(selection.value)}</dd>
            </div>
          ))}
        </dl>
        <div className="probability-quality">
          <div><span>Evidence quality</span><strong>{qualityPercent}%</strong></div>
          <div className="probability-quality-track" role="progressbar" aria-label="Evidence quality" aria-valuemin={0} aria-valuemax={100} aria-valuenow={qualityPercent}>
            <span style={{ width: `${qualityPercent}%` }} />
          </div>
        </div>
      </figcaption>
    </figure>
  );
}
