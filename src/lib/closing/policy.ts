import { shinNoVigProbabilities } from "@/lib/sports/prediction/odds";

/**
 * Closing price capture, policy `close.v1`.
 *
 * The existing mechanism is a boolean: `op_mark_closing_odds()` flips
 * `is_closing` on the last pre-kickoff quote per bookmaker. That records which
 * row was last. It does not record how many books were behind it, how stale the
 * quote was, or — the part that matters — why a close is absent when it is.
 *
 * A capture status with no odds is the whole point. The failure this replaces
 * is the one where a missing close becomes a zero somewhere downstream and a
 * CLV average quietly includes fixtures nobody ever priced.
 */

export const CLOSING_POLICY_VERSION = "close.v1";

/** The window a quote must fall inside to be eligible at all. */
export const WINDOW_MINUTES = 90;
/**
 * How far behind the newest qualifying quote a book may be and still count.
 *
 * Measured relative to the close itself, not to kickoff. The first version of
 * this policy measured staleness from kickoff at 45 minutes inside a 90-minute
 * window — which meant the window never bound on anything, the effective window
 * was 45 minutes, and the "90-minute window" in the documentation described a
 * rule that could not fire. Two constraints where one silently dominated.
 *
 * Relative is also the right semantics. A consensus close is books priced at
 * roughly the same moment; a book quoting 40 minutes out is only stale if the
 * others quoted at 5.
 */
export const MAX_LAG_MINUTES = 45;
/** Distinct books required after staleness filtering. */
export const MIN_SOURCE_DEPTH = 3;

export type CaptureStatus =
  | "captured"
  | "insufficient_sources"
  | "no_quotes"
  | "stale"
  | "market_unmapped"
  | "identity_failure"
  | "late_provider_data"
  | "operator_unavailable";

export type EligibleQuote = {
  bookmaker: string;
  /** Decimal odds for the claim's own selection. */
  decimalOdds: number;
  observedAt: string;
  /**
   * Every selection this book priced for the market at that moment, needed to
   * de-vig. A quote without its siblings cannot produce a probability, only a
   * price.
   */
  marketPrices: Array<{ selection: string; decimalOdds: number }>;
};

export type ClosingCaptureInput = {
  selectionKey: string;
  /** The selection segment the claim backed, matched inside `marketPrices`. */
  selection: string;
  kickoffAt: string;
  quotes: EligibleQuote[];
  /** True when the market resolved but no alias mapped it. */
  marketUnmapped?: boolean;
  identityFailure?: boolean;
};

export type ClosingCapture = {
  policyVersion: string;
  captureStatus: CaptureStatus;
  /** Null unless `captureStatus` is `captured`. Enforced by the caller and by a check constraint. */
  closingOdds: number | null;
  closingProbability: number | null;
  sourceCount: number;
  sourceBookmakers: string[];
  closeObservedAt: string | null;
  missingReason: string | null;
  /** Quotes seen but refused, so coverage can say why rather than just how many. */
  rejected: { lateAfterStart: number; outsideWindow: number; stale: number };
};

function minutesBefore(kickoff: string, observedAt: string): number {
  return (new Date(kickoff).getTime() - new Date(observedAt).getTime()) / 60_000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

function absent(
  status: CaptureStatus,
  missingReason: string,
  rejected: ClosingCapture["rejected"],
  sourceBookmakers: string[] = []
): ClosingCapture {
  return {
    policyVersion: CLOSING_POLICY_VERSION,
    captureStatus: status,
    closingOdds: null,
    closingProbability: null,
    sourceCount: sourceBookmakers.length,
    sourceBookmakers,
    closeObservedAt: null,
    missingReason,
    rejected
  };
}

/**
 * Compute the close, or record precisely why there isn't one.
 *
 * There is deliberately no fallback branch. Not to the opening price, not to
 * the most recent quote whenever it was, not to a single book when depth is
 * short. Every one of those produces a number that looks like a close and is
 * not one, and a number that looks right is much harder to detect than an
 * absent one.
 */
export function captureClose(input: ClosingCaptureInput): ClosingCapture {
  const rejected = { lateAfterStart: 0, outsideWindow: 0, stale: 0 };

  if (input.identityFailure) {
    return absent("identity_failure", "The claim's fixture or participant identity could not be resolved.", rejected);
  }
  if (input.marketUnmapped) {
    return absent("market_unmapped", "No canonical alias maps this market, so no quote can be matched to the claim.", rejected);
  }

  const windowed: EligibleQuote[] = [];
  for (const quote of input.quotes) {
    const lead = minutesBefore(input.kickoffAt, quote.observedAt);
    if (lead < 0) {
      // A price observed after the ball is rolling is not a closing price. It
      // is recorded as refused rather than dropped, so coverage can tell "the
      // provider was late" apart from "nobody priced it".
      rejected.lateAfterStart += 1;
      continue;
    }
    if (lead > WINDOW_MINUTES) {
      rejected.outsideWindow += 1;
      continue;
    }
    windowed.push(quote);
  }

  if (windowed.length === 0) {
    if (rejected.lateAfterStart > 0) {
      return absent(
        "late_provider_data",
        `Every quote for this selection arrived after kickoff (${rejected.lateAfterStart} refused).`,
        rejected
      );
    }
    return absent("no_quotes", "No quote was observed for this selection inside the closing window.", rejected);
  }

  // One quote per book: the latest inside the window.
  const latestByBook = new Map<string, EligibleQuote>();
  for (const quote of windowed) {
    const held = latestByBook.get(quote.bookmaker);
    if (!held || quote.observedAt > held.observedAt) latestByBook.set(quote.bookmaker, quote);
  }

  // Staleness is judged against the newest quote in the window, so a book that
  // priced 40 minutes out counts when the others did too, and is dropped only
  // when the rest of the market moved after it.
  const newestObservedAt = [...latestByBook.values()].reduce(
    (latest, quote) => (quote.observedAt > latest ? quote.observedAt : latest),
    ""
  );
  const fresh: EligibleQuote[] = [];
  for (const quote of latestByBook.values()) {
    const lagMinutes = (new Date(newestObservedAt).getTime() - new Date(quote.observedAt).getTime()) / 60_000;
    if (lagMinutes > MAX_LAG_MINUTES) {
      rejected.stale += 1;
      continue;
    }
    fresh.push(quote);
  }

  if (fresh.length === 0) {
    return absent(
      "stale",
      `All ${rejected.stale} book quotes inside the window lagged the newest by more than ${MAX_LAG_MINUTES} minutes.`,
      rejected
    );
  }

  const bookmakers = fresh.map((quote) => quote.bookmaker).sort();
  if (fresh.length < MIN_SOURCE_DEPTH) {
    return absent(
      "insufficient_sources",
      `Only ${fresh.length} book${fresh.length === 1 ? "" : "s"} priced this selection at the close; ${MIN_SOURCE_DEPTH} required.`,
      rejected,
      bookmakers
    );
  }

  const closingOdds = median(fresh.map((quote) => quote.decimalOdds));
  const closingProbability = consensusProbability(fresh, input.selection);
  const closeObservedAt = fresh.reduce((latest, quote) => (quote.observedAt > latest ? quote.observedAt : latest), fresh[0]!.observedAt);

  return {
    policyVersion: CLOSING_POLICY_VERSION,
    captureStatus: "captured",
    closingOdds: Number(closingOdds.toFixed(4)),
    closingProbability: closingProbability === null ? null : Number(closingProbability.toFixed(6)),
    sourceCount: fresh.length,
    sourceBookmakers: bookmakers,
    closeObservedAt,
    missingReason: null,
    rejected
  };
}

/**
 * Median of the per-book Shin de-vigged probabilities.
 *
 * Shin per book rather than proportional de-vig, and the median taken after
 * de-vigging rather than before: proportional de-vig charges the margin evenly
 * and so overstates every longshot, and taking a median of raw implied
 * probabilities cannot wash that out because every book carries the same bias.
 * This matches `oddsConsensus.ts`, which reached the same conclusion for live
 * pricing.
 */
export function consensusProbability(quotes: EligibleQuote[], selection: string): number | null {
  const probabilities: number[] = [];
  for (const quote of quotes) {
    const prices = quote.marketPrices;
    if (prices.length < 2) continue;
    const index = prices.findIndex((price) => price.selection === selection);
    if (index < 0) continue;
    const implied = prices.map((price) => (price.decimalOdds > 1 ? 1 / price.decimalOdds : 0));
    if (implied.some((value) => value <= 0)) continue;
    const deVigged = shinNoVigProbabilities(implied);
    const value = deVigged[index];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) probabilities.push(value);
  }
  if (probabilities.length === 0) return null;
  const sorted = [...probabilities].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2 : (sorted[middle] ?? 0);
}

/** The operator's "mark unavailable", which is a status with a reason and never a zero. */
export function operatorUnavailable(reason: string): ClosingCapture {
  return absent("operator_unavailable", reason, { lateAfterStart: 0, outsideWindow: 0, stale: 0 });
}
