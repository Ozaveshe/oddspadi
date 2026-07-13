"use client";

import Link from "next/link";
import type { Match, Prediction } from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { ConfidenceBadge, MatchStatusBadge, RiskBadge, ValueEdgeBadge } from "./Badges";
import { LocalTime } from "./LocalTime";
import { ProbabilityBar } from "./ProbabilityBar";
import { TeamCrest } from "./TeamCrest";
import { CountryFlag } from "./CountryFlag";
import { useFollowedTeams } from "@/components/account/FollowedTeamsProvider";
import { AddToSlipButton } from "./AddToSlipButton";

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

/** The model's favoured outcome (highest probability) — its directional read,
 *  which exists even when there are no odds to price a value bet against. */
function modelLean(match: Match, probabilities: Record<string, number | undefined>) {
  const entries: Array<[string, number]> = [
    [match.homeTeam.name, probabilities.home ?? 0],
    ...(match.sport === "football" ? ([["Draw", probabilities.draw ?? 0]] as Array<[string, number]>) : []),
    [match.awayTeam.name, probabilities.away ?? 0]
  ];
  return entries.reduce((best, current) => (current[1] > best[1] ? current : best));
}

export function MatchCard({ match, prediction }: { match: Match; prediction: Prediction }) {
  const followed = useFollowedTeams();
  const odds = mainOdds(match);
  const probabilities = winnerProbabilities(prediction);
  const hasValue = prediction.bestPick.hasValue;
  const bestEdge = hasValue ? prediction.bestPick.edge : 0;
  const winnerLabel = winnerMarketLabel(match);
  const hasOdds = odds.length > 0;
  const [leanLabel, leanProb] = modelLean(match, probabilities);

  return (
    <article className={`match-card${followed.isFollowed(match.homeTeam.name) || followed.isFollowed(match.awayTeam.name) ? " followed-team-row" : ""}`}>
      <div className="match-main">
        <div>
          <div className="meta">
            {match.dataSource?.kind === "mock" ? <span className="badge scheduled">Preview</span> : null}
            <span>
              <LocalTime iso={match.kickoffTime} />
            </span>
            <span className="league-tag">
              {match.league.logo ? <TeamCrest name={match.league.name} logo={match.league.logo} size={16} /> : null}
              {match.league.name}
            </span>
            <span className="country-inline"><CountryFlag country={match.league.country} flag={match.league.flag} size={16} />{match.league.country}</span>
            <MatchStatusBadge status={match.status} />
          </div>
          <div className="teams">
            <span className="team-inline">
              <TeamCrest name={match.homeTeam.name} logo={match.homeTeam.logo} size={26} />
              {match.homeTeam.name}
            </span>
            <span className="teams-vs">vs</span>
            <span className="team-inline">
              <TeamCrest name={match.awayTeam.name} logo={match.awayTeam.logo} size={26} />
              {match.awayTeam.name}
            </span>
          </div>
        </div>
        <Link
          className="button small-btn"
          href={`/predictions/${match.id}`}
          aria-label={`Full analysis: ${match.homeTeam.name} vs ${match.awayTeam.name}`}
        >
          Full analysis
        </Link>
      </div>

      <div className="metrics-grid">
        <div className="metric">
          <span className="metric-label">Odds {winnerLabel}</span>
          <span className="metric-value">
            {hasOdds ? odds.map((selection) => formatOdds(selection.decimalOdds)).join(" / ") : "Not available"}
          </span>
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
          <span className="metric-label">Model lean</span>
          <span className="metric-value">
            {leanLabel} · {formatPercent(leanProb)}
          </span>
        </div>
        <div className="metric">
          <span className="metric-label">Value edge</span>
          <span className="metric-value">{hasValue ? formatSignedPercent(bestEdge) : hasOdds ? "None found" : "Needs odds"}</span>
        </div>
        <div className="metric">
          <span className="metric-label">Expected value</span>
          <span className="metric-value">
            {hasValue ? formatSignedPercent(prediction.bestPick.expectedValue) : hasOdds ? "Not positive" : "Needs odds"}
          </span>
        </div>
      </div>

      <div className="grid-2">
        <ProbabilityBar label={match.homeTeam.name} value={probabilities.home ?? 0} />
        <ProbabilityBar label={match.awayTeam.name} value={probabilities.away ?? 0} />
      </div>

      {/* Only surface pick-level confidence/risk when there's an actual value bet.
          Otherwise show the model's read honestly — an unpriced match isn't a
          "low confidence / high risk" failure, it just has no value bet yet. */}
      <div className="meta">
        {hasValue ? (
          <>
            <ConfidenceBadge level={prediction.confidence} />
            <RiskBadge level={prediction.risk} />
            <ValueEdgeBadge edge={bestEdge} />
          </>
        ) : (
          <>
            <span className="badge medium-risk">
              Model leans {leanLabel} · {formatPercent(leanProb)}
            </span>
            <span className="muted small">
              {hasOdds ? "No value edge at current odds" : "Odds pending — value needs bookmaker prices"}
            </span>
          </>
        )}
      </div>
      <div className="card-actions"><AddToSlipButton match={match} prediction={prediction} compact /><Link className="button small-btn" href="/predictions/bet-slip">View slip</Link></div>
    </article>
  );
}
