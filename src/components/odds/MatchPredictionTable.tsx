import Link from "next/link";
import type { PredictionListRow } from "@/lib/sports/prediction/listRow";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { ConfidenceBadge, MatchStatusBadge, RiskBadge } from "./Badges";
import { LocalTime } from "./LocalTime";
import { TeamCrest } from "./TeamCrest";
import { CountryFlag } from "./CountryFlag";
import { AddToSlipButton } from "./AddToSlipButton";

export function MatchPredictionTable({ rows }: { rows: PredictionListRow[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Kickoff</th>
            <th scope="col">Match</th>
            <th scope="col">Odds</th>
            <th scope="col">Model</th>
            <th scope="col">Pick</th>
            <th scope="col">No-vig edge</th>
            <th scope="col">EV</th>
            <th scope="col">Risk</th>
            <th scope="col">Detail</th>
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
                  <LocalTime iso={match.kickoffTime} />
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
                    <span className="country-inline"><CountryFlag country={match.league.country} flag={match.league.flag} size={14} />{match.league.name}, {match.league.country}</span>
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
                  <Link
                    className="button"
                    href={`/predictions/${match.id}`}
                    aria-label={`Open ${match.homeTeam.name} vs ${match.awayTeam.name} analysis`}
                  >
                    Open
                  </Link>
                  <AddToSlipButton match={match} prediction={prediction} compact />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
