import Link from "next/link";
import type { Match, Prediction } from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { ConfidenceBadge, RiskBadge } from "./Badges";

export function ValuePickCard({ match, prediction }: { match: Match; prediction: Prediction }) {
  if (!prediction.bestPick.hasValue) return null;

  return (
    <article className="value-card">
      <div className="row-between">
        <div>
          <strong>
            {match.homeTeam.name} vs {match.awayTeam.name}
          </strong>
          <div className="small muted">
            {match.league.name} · {new Date(match.kickoffTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <Link className="button small-btn" href={`/predictions/${match.id}`}>
          See why
        </Link>
      </div>
      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Pick</span>
          <span className="metric-value">{prediction.bestPick.label}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Odds</span>
          <span className="metric-value">{formatOdds(prediction.bestPick.odds)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Model / no-vig</span>
          <span className="metric-value">
            {formatPercent(prediction.bestPick.modelProbability)} / {formatPercent(prediction.bestPick.noVigImpliedProbability)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">No-vig edge</span>
          <span className="metric-value">{formatSignedPercent(prediction.bestPick.edge)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">EV / unit</span>
          <span className="metric-value">{formatSignedPercent(prediction.bestPick.expectedValue)}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Book margin</span>
          <span className="metric-value">{formatSignedPercent(prediction.bestPick.bookmakerMargin)}</span>
        </div>
      </div>
      <div className="meta">
        <ConfidenceBadge level={prediction.bestPick.confidence} />
        <RiskBadge level={prediction.bestPick.risk} />
      </div>
    </article>
  );
}
