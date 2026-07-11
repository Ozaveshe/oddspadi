import Link from "next/link";
import type { Match, Prediction } from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { ConfidenceBadge, MatchStatusBadge, RiskBadge, ValueEdgeBadge } from "./Badges";
import { ProbabilityBar } from "./ProbabilityBar";

function mainOdds(match: Match) {
  return match.oddsMarkets.find((market) => market.id === "match_winner")?.selections ?? [];
}

function winnerProbabilities(prediction: Prediction) {
  return prediction.markets.find((market) => market.marketId === "match_winner")?.probabilities ?? {};
}

function winnerMarketLabel(match: Match): string {
  if (match.sport === "football") return "1-X-2";
  if (match.sport === "basketball") return "Moneyline";
  if (match.sport === "tennis") return "Match winner";
  return "Winner";
}

export function MatchCard({ match, prediction }: { match: Match; prediction: Prediction }) {
  const odds = mainOdds(match);
  const probabilities = winnerProbabilities(prediction);
  const bestEdge = prediction.bestPick.hasValue ? prediction.bestPick.edge : 0;
  const winnerLabel = winnerMarketLabel(match);

  return (
    <article className="match-card">
      <div className="match-main">
        <div>
          <div className="meta">
            <span>{new Date(match.kickoffTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <span>{match.league.name}</span>
            <span>{match.league.country}</span>
            <MatchStatusBadge status={match.status} />
          </div>
          <div className="teams">
            {match.homeTeam.name} vs {match.awayTeam.name}
          </div>
        </div>
        <Link className="button small-btn" href={`/predictions/${match.id}`}>
          Full analysis
        </Link>
      </div>

      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Odds {winnerLabel}</span>
          <span className="metric-value">{odds.map((selection) => formatOdds(selection.decimalOdds)).join(" / ")}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Model {winnerLabel}</span>
          <span className="metric-value">
            {match.sport === "football"
              ? `${formatPercent(probabilities.home ?? 0)} / ${formatPercent(probabilities.draw ?? 0)} / ${formatPercent(probabilities.away ?? 0)}`
              : `${formatPercent(probabilities.home ?? 0)} / ${formatPercent(probabilities.away ?? 0)}`}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Best pick</span>
          <span className="metric-value">{prediction.bestPick.label}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Value edge</span>
          <span className="metric-value">{prediction.bestPick.hasValue ? formatSignedPercent(bestEdge) : "None found"}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Expected value</span>
          <span className="metric-value">
            {prediction.bestPick.hasValue ? formatSignedPercent(prediction.bestPick.expectedValue) : "Not positive"}
          </span>
        </div>
      </div>

      <div className="grid-2">
        <ProbabilityBar label={match.homeTeam.name} value={probabilities.home ?? 0} />
        <ProbabilityBar label={match.awayTeam.name} value={probabilities.away ?? 0} />
      </div>

      <div className="meta">
        <ConfidenceBadge level={prediction.confidence} />
        <RiskBadge level={prediction.risk} />
        <ValueEdgeBadge edge={bestEdge} />
      </div>
    </article>
  );
}
