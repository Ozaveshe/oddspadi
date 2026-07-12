import Link from "next/link";
import type { Match, Prediction } from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { ConfidenceBadge, MatchStatusBadge, RiskBadge } from "./Badges";
import { TeamCrest } from "./TeamCrest";

export function MatchPredictionTable({ rows }: { rows: Array<{ match: Match; prediction: Prediction }> }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Kickoff</th>
            <th>Match</th>
            <th>Odds</th>
            <th>Model</th>
            <th>Pick</th>
            <th>No-vig edge</th>
            <th>EV</th>
            <th>Risk</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ match, prediction }) => {
            const odds = match.oddsMarkets.find((market) => market.id === "match_winner")?.selections ?? [];
            const market = prediction.markets.find((item) => item.marketId === "match_winner");
            const modelText =
              match.sport === "football"
                ? `${formatPercent(market?.probabilities.home ?? 0)} / ${formatPercent(market?.probabilities.draw ?? 0)} / ${formatPercent(
                    market?.probabilities.away ?? 0
                  )}`
                : `${formatPercent(market?.probabilities.home ?? 0)} / ${formatPercent(market?.probabilities.away ?? 0)}`;
            return (
              <tr key={match.id}>
                <td>
                  {new Date(match.kickoffTime).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  <br />
                  <MatchStatusBadge status={match.status} />
                </td>
                <td>
                  <span className="table-match">
                    <span className="team-inline">
                      <TeamCrest name={match.homeTeam.name} logo={match.homeTeam.logo} size={20} />
                      <strong>{match.homeTeam.name}</strong>
                    </span>
                    <span className="teams-vs">vs</span>
                    <span className="team-inline">
                      <TeamCrest name={match.awayTeam.name} logo={match.awayTeam.logo} size={20} />
                      <strong>{match.awayTeam.name}</strong>
                    </span>
                  </span>
                  <br />
                  <span className="small muted">
                    {match.league.name}, {match.league.country}
                  </span>
                </td>
                <td>{odds.map((selection) => formatOdds(selection.decimalOdds)).join(" / ")}</td>
                <td>{modelText}</td>
                <td>
                  {prediction.bestPick.label}
                  <br />
                  <ConfidenceBadge level={prediction.confidence} />
                </td>
                <td>{prediction.bestPick.hasValue ? formatSignedPercent(prediction.bestPick.edge) : "No clear value found"}</td>
                <td>{prediction.bestPick.hasValue ? formatSignedPercent(prediction.bestPick.expectedValue) : "No positive EV"}</td>
                <td>
                  <RiskBadge level={prediction.risk} />
                </td>
                <td>
                  <Link className="button" href={`/predictions/${match.id}`}>
                    Open
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
