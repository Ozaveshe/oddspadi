import type { Match, Prediction } from "@/lib/sports/types";
import { formatOdds, formatPercent } from "@/lib/sports/prediction/format";

/**
 * Every market the model prices, whether or not a bookmaker quote is attached.
 *
 * The market-analysis table renders `match.oddsMarkets`, so a fixture whose
 * odds feed only carries the 1X2 showed nothing else — the model's totals,
 * BTTS, team totals, clean sheets and scorelines were computed on every run and
 * then thrown away at the render. That is why match pages read as "win or loss
 * and nothing more".
 *
 * Selections carrying a live price show it; the rest are labelled as model
 * probabilities. No odds are invented for unpriced selections, and no value
 * language is used here at all — value claims live with the gated pick, not
 * with a probability read-out.
 */

function decimalFromToken(token: string): string {
  // `over_25` encodes the 2.5 line; `over_05` encodes 0.5.
  return token.length >= 2 ? `${token.slice(0, -1)}.${token.slice(-1)}` : token;
}

function marketLabel(marketId: string, match: Match): string {
  if (marketId === "match_winner") return "Match winner (1X2)";
  if (marketId === "double_chance") return "Double chance";
  if (marketId === "draw_no_bet") return "Draw no bet";
  if (marketId === "both_teams_to_score") return "Both teams to score";
  if (marketId === "correct_score") return "Correct score";
  if (marketId === "clean_sheet_home") return `${match.homeTeam.name} clean sheet`;
  if (marketId === "clean_sheet_away") return `${match.awayTeam.name} clean sheet`;
  const teamTotal = /^(home|away)_team_over_under_(\d+)$/.exec(marketId);
  if (teamTotal) {
    const team = teamTotal[1] === "home" ? match.homeTeam.name : match.awayTeam.name;
    return `${team} goals over/under ${decimalFromToken(teamTotal[2])}`;
  }
  const total = /^over_under_(\d+)$/.exec(marketId);
  if (total) return `Total goals over/under ${decimalFromToken(total[1])}`;
  return marketId.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function selectionLabel(marketId: string, selectionId: string, match: Match): string {
  if (selectionId === "home") return marketId === "draw_no_bet" ? `${match.homeTeam.name} (DNB)` : match.homeTeam.name;
  if (selectionId === "away") return marketId === "draw_no_bet" ? `${match.awayTeam.name} (DNB)` : match.awayTeam.name;
  if (selectionId === "draw") return "Draw";
  if (selectionId === "yes") return "Yes";
  if (selectionId === "no") return "No";
  if (selectionId === "home_or_draw") return `${match.homeTeam.name} or draw`;
  if (selectionId === "home_or_away") return `${match.homeTeam.name} or ${match.awayTeam.name}`;
  if (selectionId === "draw_or_away") return `Draw or ${match.awayTeam.name}`;
  if (selectionId === "other") return "Any other score";
  const overUnder = /^(over|under)_(\d+)$/.exec(selectionId);
  if (overUnder) return `${overUnder[1] === "over" ? "Over" : "Under"} ${decimalFromToken(overUnder[2])}`;
  const score = /^(\d+)_(\d+)$/.exec(selectionId);
  if (score) return `${score[1]}–${score[2]}`;
  return selectionId.replaceAll("_", " ");
}

export function ModelMarketBoard({ match, prediction }: { match: Match; prediction: Prediction }) {
  const pricedSelections = new Map(
    match.oddsMarkets.flatMap((market) =>
      market.selections
        .filter((selection) => Number.isFinite(selection.decimalOdds) && selection.decimalOdds > 1)
        .map((selection) => [`${market.id}:${selection.id}`, selection.decimalOdds] as const)
    )
  );

  const markets = prediction.markets.filter((market) => Object.keys(market.probabilities).length > 0);
  if (!markets.length) return null;

  return (
    <div className="panel">
      <h2>Model market board</h2>
      <p className="muted small">
        Every market the model prices for this fixture, from one scoreline distribution. Selections without a live
        bookmaker quote show the model probability only — a probability is not a betting recommendation.
      </p>
      <div className="model-market-board">
        {markets.map((market) => {
          const entries = Object.entries(market.probabilities);
          const anyPriced = entries.some(([selectionId]) => pricedSelections.has(`${market.marketId}:${selectionId}`));
          return (
            <section className="model-market-group" key={market.marketId} aria-label={marketLabel(market.marketId, match)}>
              <header className="model-market-header">
                <h3>{marketLabel(market.marketId, match)}</h3>
                {anyPriced ? null : <span className="muted small">model only — no live price</span>}
              </header>
              <ul className="model-market-selections">
                {entries.map(([selectionId, probability]) => {
                  const odds = pricedSelections.get(`${market.marketId}:${selectionId}`);
                  return (
                    <li key={selectionId}>
                      <span className="model-market-selection-label">{selectionLabel(market.marketId, selectionId, match)}</span>
                      <span className="model-market-selection-values">
                        <strong>{formatPercent(probability)}</strong>
                        {odds ? <span className="muted small"> @ {formatOdds(odds)}</span> : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
