import type { OddsMarket, OddsSelection } from "@/lib/sports/types";

export type ExecutableOddsQuote = {
  point?: number;
  selections: OddsSelection[];
  bookmaker?: OddsMarket["bookmaker"];
  observedAt?: string | null;
};

function timestamp(value: string | null | undefined): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function sourceKey(quote: ExecutableOddsQuote): string {
  return `${quote.bookmaker?.id ?? "unknown"}:${quote.bookmaker?.name ?? "unknown"}`;
}

/**
 * Shops each selection across complete, line-compatible bookmaker quotes.
 * The returned prices are only for execution and never form the no-vig prior.
 */
export function buildBestExecutableQuote(quotes: ExecutableOddsQuote[]): ExecutableOddsQuote | null {
  const complete = quotes.filter(
    (quote) => quote.selections.length >= 2 && quote.selections.every((selection) => Number.isFinite(selection.decimalOdds) && selection.decimalOdds > 1)
  );
  if (!complete.length) return null;

  const pointKeys = new Set(complete.map((quote) => typeof quote.point === "number" ? quote.point.toFixed(3) : "no-line"));
  if (pointKeys.size > 1) return null;

  const referenceIds = complete[0].selections.map((selection) => selection.id);
  const sortedReferenceIds = [...referenceIds].sort();
  const comparable = complete.filter((quote) => {
    const ids = quote.selections.map((selection) => selection.id).sort();
    return ids.length === sortedReferenceIds.length && ids.every((id, index) => id === sortedReferenceIds[index]);
  });
  if (!comparable.length) return null;

  const selections: OddsSelection[] = [];
  for (const selectionId of referenceIds) {
    const candidates = comparable
      .flatMap((quote) => {
        const selection = quote.selections.find((item) => item.id === selectionId);
        return selection ? [{ quote, selection }] : [];
      })
      .sort((left, right) => {
        if (right.selection.decimalOdds !== left.selection.decimalOdds) return right.selection.decimalOdds - left.selection.decimalOdds;
        const timestampDelta = timestamp(right.quote.observedAt) - timestamp(left.quote.observedAt);
        if (timestampDelta !== 0) return timestampDelta;
        return sourceKey(left.quote).localeCompare(sourceKey(right.quote));
      });
    const winner = candidates[0];
    if (!winner) return null;
    selections.push({
      ...winner.selection,
      ...(winner.quote.bookmaker ? { bookmaker: winner.quote.bookmaker } : {}),
      observedAt: winner.quote.observedAt ?? null
    });
  }

  const sources = new Map(selections.flatMap((selection) => selection.bookmaker ? [[selection.bookmaker.id, selection.bookmaker] as const] : []));
  const observedTimes = selections.map((selection) => selection.observedAt).filter((value): value is string => Boolean(value));

  return {
    point: comparable[0].point,
    selections,
    bookmaker: sources.size === 1 ? [...sources.values()][0] : undefined,
    observedAt: observedTimes.sort((left, right) => timestamp(right) - timestamp(left))[0] ?? null
  };
}
