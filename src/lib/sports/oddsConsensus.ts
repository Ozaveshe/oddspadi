import type { OddsMarketConsensus, OddsSelection } from "@/lib/sports/types";
import { shinNoVigProbabilities } from "@/lib/sports/prediction/odds";

export type ConsensusOddsQuote = {
  selections: OddsSelection[];
  bookmaker?: { id: string; name: string };
};

function round(value: number, digits = 6): number {
  return Number(value.toFixed(digits));
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function normalizedQuote(quote: ConsensusOddsQuote, selectionIds: string[]): { probabilities: Record<string, number>; margin: number } | null {
  const byId = new Map(quote.selections.map((selection) => [selection.id, selection]));
  if (byId.size !== selectionIds.length) return null;
  const implied = selectionIds.map((id) => {
    const odds = byId.get(id)?.decimalOdds;
    return typeof odds === "number" && Number.isFinite(odds) && odds > 1 ? 1 / odds : 0;
  });
  if (implied.some((probability) => probability <= 0)) return null;
  const total = implied.reduce((sum, probability) => sum + probability, 0);
  if (!Number.isFinite(total) || total <= 0) return null;
  // Shin per book rather than proportional: proportional de-vig charges the
  // margin evenly and so overstates every longshot; the median across books
  // cannot wash that out because every book carries the same bias.
  const deVigged = shinNoVigProbabilities(implied);
  return {
    probabilities: Object.fromEntries(selectionIds.map((id, index) => [id, deVigged[index] ?? 0])),
    margin: total - 1
  };
}

/**
 * Builds a robust belief prior from complete bookmaker quotes. It never creates
 * an executable synthetic price: the provider retains one coherent quote for EV.
 */
export function buildNoVigBookmakerConsensus(quotes: ConsensusOddsQuote[]): OddsMarketConsensus | undefined {
  const firstComplete = quotes.find((quote) => quote.selections.length >= 2 && quote.selections.every((selection) => selection.id));
  if (!firstComplete) return undefined;
  const selectionIds = firstComplete.selections.map((selection) => selection.id);
  if (new Set(selectionIds).size !== selectionIds.length) return undefined;

  const uniqueQuotes = new Map<string, ConsensusOddsQuote>();
  for (const [index, quote] of quotes.entries()) {
    const key = quote.bookmaker?.id?.trim() || `unknown-${index}`;
    const existing = uniqueQuotes.get(key);
    if (!existing) {
      uniqueQuotes.set(key, quote);
      continue;
    }
    const existingNormalized = normalizedQuote(existing, selectionIds);
    const candidateNormalized = normalizedQuote(quote, selectionIds);
    if (candidateNormalized && (!existingNormalized || Math.abs(candidateNormalized.margin) < Math.abs(existingNormalized.margin))) {
      uniqueQuotes.set(key, quote);
    }
  }

  const normalized = [...uniqueQuotes.values()]
    .map((quote) => normalizedQuote(quote, selectionIds))
    .filter((quote): quote is NonNullable<typeof quote> => quote !== null);
  if (!normalized.length) return undefined;

  const medians = Object.fromEntries(
    selectionIds.map((id) => [id, median(normalized.map((quote) => quote.probabilities[id] ?? 0))])
  );
  const medianTotal = selectionIds.reduce((sum, id) => sum + (medians[id] ?? 0), 0);
  if (medianTotal <= 0) return undefined;
  const probabilities = Object.fromEntries(selectionIds.map((id) => [id, round((medians[id] ?? 0) / medianTotal)]));
  const maxProbabilitySpread = Math.max(
    ...selectionIds.map((id) => {
      const values = normalized.map((quote) => quote.probabilities[id] ?? 0);
      return Math.max(...values) - Math.min(...values);
    })
  );

  return {
    method: "median-shin-no-vig-v2",
    bookmakerCount: normalized.length,
    probabilities,
    averageMargin: round(normalized.reduce((sum, quote) => sum + quote.margin, 0) / normalized.length),
    maxProbabilitySpread: round(maxProbabilitySpread)
  };
}
