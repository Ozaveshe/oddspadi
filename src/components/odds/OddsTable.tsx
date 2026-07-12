import type { OddsMarket, Prediction } from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "@/lib/sports/prediction/format";

export function OddsTable({ oddsMarkets, prediction }: { oddsMarkets: OddsMarket[]; prediction: Prediction }) {
  const edgesBySelection = new Map(prediction.valueEdges.map((edge) => [`${edge.marketId}:${edge.selectionId}`, edge]));

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Market</th>
            <th scope="col">Selection</th>
            <th scope="col">Odds</th>
            <th scope="col">Model</th>
            <th scope="col">Raw implied</th>
            <th scope="col">No-vig implied</th>
            <th scope="col">Margin</th>
            <th scope="col">No-vig edge</th>
            <th scope="col">EV</th>
          </tr>
        </thead>
        <tbody>
          {oddsMarkets.flatMap((market) =>
            market.selections.map((selection) => {
              const edge = edgesBySelection.get(`${market.id}:${selection.id}`);
              return (
                <tr key={`${market.id}-${selection.id}`}>
                  <td>{market.name}</td>
                  <td>{selection.label}</td>
                  <td>{formatOdds(selection.decimalOdds)}</td>
                  <td>{edge ? formatPercent(edge.modelProbability) : "N/A"}</td>
                  <td>{edge ? formatPercent(edge.rawImpliedProbability) : "N/A"}</td>
                  <td>{edge ? formatPercent(edge.noVigImpliedProbability) : "N/A"}</td>
                  <td>{edge ? formatSignedPercent(edge.bookmakerMargin) : "N/A"}</td>
                  <td>{edge ? formatSignedPercent(edge.edge) : "N/A"}</td>
                  <td>{edge ? formatSignedPercent(edge.expectedValue) : "N/A"}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
