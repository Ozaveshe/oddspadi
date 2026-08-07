/**
 * Closing line value, method `clv.v1`.
 *
 * Two series, deliberately both kept.
 *
 *   odds-based         published_odds / closing_odds − 1
 *   probability-based  p_close_novig − p_published_novig
 *
 * They carry the same sign — positive means the price beat the close — and
 * disagree in magnitude on longshots, which is exactly where this book has been
 * misled before. Reporting only the odds series makes a longshot that drifted
 * from 12.0 to 9.0 look like a +33% triumph; the probability series says the
 * market moved 2.8 points toward us, which is the honest size of it.
 */

export const CLV_METHOD_VERSION = "clv.v1";

export type ClvRow = {
  publishedOdds: number;
  publishedProbabilityNoVig: number | null;
  closingOdds: number | null;
  closingProbability: number | null;
};

export function oddsClv(publishedOdds: number, closingOdds: number | null): number | null {
  if (closingOdds === null) return null;
  if (!Number.isFinite(publishedOdds) || !Number.isFinite(closingOdds)) return null;
  if (publishedOdds <= 1 || closingOdds <= 1) return null;
  return publishedOdds / closingOdds - 1;
}

export function probabilityClv(publishedProbabilityNoVig: number | null, closingProbability: number | null): number | null {
  if (publishedProbabilityNoVig === null || closingProbability === null) return null;
  if (!Number.isFinite(publishedProbabilityNoVig) || !Number.isFinite(closingProbability)) return null;
  return closingProbability - publishedProbabilityNoVig;
}

/**
 * A CLV series and the denominator it was taken over.
 *
 * `covered`, `uncovered` and `mean` are one non-optional triple so a caller
 * cannot render the mean without also holding what it was measured on. That is
 * the entire defence against a missing close becoming a zero: not a rule about
 * how to treat nulls, but a return type that will not let you forget them.
 */
export type ClvSeries = {
  covered: number;
  uncovered: number;
  mean: number | null;
  median: number | null;
};

export type ClvSummary = {
  method: string;
  eligible: number;
  odds: ClvSeries;
  probability: ClvSeries;
};

function series(values: Array<number | null>): ClvSeries {
  const present = values.filter((value): value is number => value !== null);
  const uncovered = values.length - present.length;
  if (present.length === 0) return { covered: 0, uncovered, mean: null, median: null };
  const mean = present.reduce((sum, value) => sum + value, 0) / present.length;
  const sorted = [...present].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const med = sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
  return { covered: present.length, uncovered, mean, median: med };
}

export function summariseClv(rows: ClvRow[]): ClvSummary {
  return {
    method: CLV_METHOD_VERSION,
    eligible: rows.length,
    odds: series(rows.map((row) => oddsClv(row.publishedOdds, row.closingOdds))),
    probability: series(rows.map((row) => probabilityClv(row.publishedProbabilityNoVig, row.closingProbability)))
  };
}
