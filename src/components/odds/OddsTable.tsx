import type { Match, Prediction } from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";
import { bookmakerDisplayName } from "@/lib/affiliate/bookmakerLinks";
import { AffiliateBookmakerLink } from "./AffiliateBookmakerLink";

export function OddsTable({ match, prediction }: { match: Match; prediction: Prediction }) {
  const oddsMarkets = match.oddsMarkets;
  const edgesBySelection = new Map(prediction.valueEdges.map((edge) => [`${edge.marketId}:${edge.selectionId}`, edge]));
  const rows = oddsMarkets.flatMap((market) => market.selections.map((selection) => ({
    id: `${market.id}-${selection.id}`,
    market,
    selection,
    edge: edgesBySelection.get(`${market.id}:${selection.id}`)
  })));

  return (
    <>
      <div className="table-wrap market-table-desktop">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Market</th>
              <th scope="col">Selection</th>
              <th scope="col">Odds</th>
              <th scope="col">Bookmaker</th>
              <th scope="col">Model</th>
              <th scope="col">Raw implied</th>
              <th scope="col">No-vig implied</th>
              <th scope="col">Margin</th>
              <th scope="col">No-vig edge</th>
              <th scope="col">EV</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ id, market, selection, edge }) => (
              <tr key={id}>
                <td>{market.name}</td>
                <td>{selection.label}</td>
                <td>{formatOdds(selection.decimalOdds)}</td>
                <td>{market.bookmaker ? bookmakerDisplayName(market.bookmaker.id, market.bookmaker.name) : "Market price"}</td>
                <td>{edge ? formatPercent(edge.modelProbability) : "N/A"}</td>
                <td>{edge ? formatPercent(edge.rawImpliedProbability) : "N/A"}</td>
                <td>{edge ? formatPercent(edge.noVigImpliedProbability) : "N/A"}</td>
                <td>{edge ? formatSignedPercent(edge.bookmakerMargin) : "N/A"}</td>
                <td>{edge ? formatSignedPercent(edge.edge) : "N/A"}</td>
                <td>{edge ? formatSignedPercent(edge.expectedValue) : "N/A"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="market-mobile-list" aria-label="Market analysis cards">
        {rows.map(({ id, market, selection, edge }) => (
          <article className="market-mobile-card" key={id}>
            <header>
              <div><span>{market.name}</span><strong>{selection.label}</strong></div>
              <strong className="market-mobile-odds">{formatOdds(selection.decimalOdds)}</strong>
            </header>
            <dl>
              <div><dt>Model chance</dt><dd>{edge ? formatPercent(edge.modelProbability) : "N/A"}</dd></div>
              <div><dt>Fair market</dt><dd>{edge ? formatPercent(edge.noVigImpliedProbability) : "N/A"}</dd></div>
              <div className={edge && edge.edge > 0 ? "positive" : "negative"}><dt>Edge</dt><dd>{edge ? formatSignedPercent(edge.edge) : "N/A"}</dd></div>
              <div className={edge && edge.expectedValue > 0 ? "positive" : "negative"}><dt>Expected value</dt><dd>{edge ? formatSignedPercent(edge.expectedValue) : "N/A"}</dd></div>
            </dl>
            <details>
              <summary>Price details</summary>
              <dl>
                <div><dt>Bookmaker</dt><dd>{market.bookmaker ? bookmakerDisplayName(market.bookmaker.id, market.bookmaker.name) : "Market price"}</dd></div>
                <div><dt>Raw implied</dt><dd>{edge ? formatPercent(edge.rawImpliedProbability) : "N/A"}</dd></div>
                <div><dt>Bookmaker margin</dt><dd>{edge ? formatSignedPercent(edge.bookmakerMargin) : "N/A"}</dd></div>
              </dl>
            </details>
          </article>
        ))}
      </div>

      {[...new Map(oddsMarkets.filter((market) => market.bookmaker).map((market) => [market.bookmaker!.id, market.bookmaker!])).values()].map((bookmaker) => (
        <AffiliateBookmakerLink key={bookmaker.id} bookmaker={bookmaker} country={match.league.country} matchId={match.id} sport={match.sport} league={match.league.name} placement="odds_table" />
      ))}
    </>
  );
}
