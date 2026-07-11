import type { MatchPredictionExplanation } from "@/lib/sports/types";

export function PredictionExplanation({ explanation }: { explanation: MatchPredictionExplanation }) {
  return (
    <div className="panel">
      <h2>OddsPadi explanation</h2>
      <p>{explanation.summary}</p>
      <ul>
        {explanation.drivers.map((driver) => (
          <li key={driver}>{driver}</li>
        ))}
      </ul>
      <p className="small muted">{explanation.disclaimer}</p>
    </div>
  );
}
