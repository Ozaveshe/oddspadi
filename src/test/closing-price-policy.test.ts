import { describe, expect, it } from "vitest";
import {
  captureClose,
  MAX_AGE_MINUTES,
  MIN_SOURCE_DEPTH,
  operatorUnavailable,
  WINDOW_MINUTES,
  type EligibleQuote
} from "@/lib/closing/policy";
import { oddsClv, probabilityClv, summariseClv } from "@/lib/closing/clv";

const KICKOFF = "2026-08-07T19:00:00.000Z";

function before(minutes: number): string {
  return new Date(new Date(KICKOFF).getTime() - minutes * 60_000).toISOString();
}

function quote(bookmaker: string, minutesBeforeKickoff: number, odds = 2.0): EligibleQuote {
  return {
    bookmaker,
    decimalOdds: odds,
    observedAt: before(minutesBeforeKickoff),
    marketPrices: [
      { selection: "home", decimalOdds: odds },
      { selection: "draw", decimalOdds: 3.4 },
      { selection: "away", decimalOdds: 4.2 }
    ]
  };
}

function capture(quotes: EligibleQuote[], overrides: Partial<Parameters<typeof captureClose>[0]> = {}) {
  return captureClose({
    selectionKey: "football.1x2.regulation.home",
    selection: "home",
    kickoffAt: KICKOFF,
    quotes,
    ...overrides
  });
}

describe("closing capture", () => {
  it("captures a consensus close from enough fresh books", () => {
    const result = capture([quote("a", 20, 1.9), quote("b", 15, 2.0), quote("c", 10, 2.1)]);
    expect(result.captureStatus).toBe("captured");
    expect(result.closingOdds).toBe(2.0);
    expect(result.sourceCount).toBe(3);
    expect(result.sourceBookmakers).toEqual(["a", "b", "c"]);
    expect(result.closeObservedAt).toBe(before(10));
    expect(result.missingReason).toBeNull();
    expect(result.closingProbability).toBeGreaterThan(0);
    expect(result.closingProbability).toBeLessThan(1);
  });

  it("takes the latest quote per book, not the first", () => {
    const result = capture([
      quote("a", 80, 3.0),
      quote("a", 5, 1.8),
      quote("b", 5, 1.9),
      quote("c", 5, 2.0)
    ]);
    expect(result.captureStatus).toBe("captured");
    expect(result.closingOdds).toBe(1.9);
  });

  it("stamps the policy version on every capture, present or absent", () => {
    expect(capture([quote("a", 5)]).policyVersion).toBe("close.v1");
    expect(capture([]).policyVersion).toBe("close.v1");
  });
});

describe("what is refused, and why", () => {
  it("refuses a price observed after kickoff and says the provider was late", () => {
    const late: EligibleQuote = { ...quote("a", 0), observedAt: new Date(new Date(KICKOFF).getTime() + 60_000).toISOString() };
    const result = capture([late]);
    expect(result.captureStatus).toBe("late_provider_data");
    expect(result.closingOdds).toBeNull();
    expect(result.rejected.lateAfterStart).toBe(1);
  });

  it("never lets a post-start price into a capture that otherwise succeeds", () => {
    const late: EligibleQuote = { ...quote("d", 0, 1.01), observedAt: new Date(new Date(KICKOFF).getTime() + 60_000).toISOString() };
    const result = capture([quote("a", 20, 1.9), quote("b", 15, 2.0), quote("c", 10, 2.1), late]);
    expect(result.captureStatus).toBe("captured");
    expect(result.sourceBookmakers).not.toContain("d");
    // 1.01 would have dragged the median down had it been admitted.
    expect(result.closingOdds).toBe(2.0);
  });

  it("refuses quotes outside the window without calling them late", () => {
    const result = capture([quote("a", WINDOW_MINUTES + 1)]);
    expect(result.captureStatus).toBe("no_quotes");
    expect(result.rejected.outsideWindow).toBe(1);
    expect(result.rejected.lateAfterStart).toBe(0);
  });

  it("refuses stale books inside the window", () => {
    const result = capture([
      quote("a", MAX_AGE_MINUTES + 1),
      quote("b", MAX_AGE_MINUTES + 5),
      quote("c", MAX_AGE_MINUTES + 10)
    ]);
    expect(result.captureStatus).toBe("stale");
    expect(result.rejected.stale).toBe(3);
    expect(result.closingOdds).toBeNull();
  });

  it("drops a stale book and then fails on depth rather than capturing on two", () => {
    const result = capture([quote("a", 10), quote("b", 10), quote("c", MAX_AGE_MINUTES + 1)]);
    expect(result.captureStatus).toBe("insufficient_sources");
    expect(result.sourceCount).toBe(2);
    expect(result.closingOdds).toBeNull();
    expect(result.missingReason).toContain(String(MIN_SOURCE_DEPTH));
  });

  it("records identity and mapping failures as their own reasons", () => {
    expect(capture([quote("a", 5)], { identityFailure: true }).captureStatus).toBe("identity_failure");
    expect(capture([quote("a", 5)], { marketUnmapped: true }).captureStatus).toBe("market_unmapped");
  });

  it("records an operator's unavailable as a status with a reason, never a zero", () => {
    const result = operatorUnavailable("Book pulled the market before kickoff; no consensus existed.");
    expect(result.captureStatus).toBe("operator_unavailable");
    expect(result.closingOdds).toBeNull();
    expect(result.missingReason).toContain("no consensus");
  });

  it("has no path that returns odds without the captured status", () => {
    const inputs = [
      capture([]),
      capture([quote("a", 5)]),
      capture([quote("a", MAX_AGE_MINUTES + 1)]),
      capture([quote("a", 5)], { marketUnmapped: true }),
      capture([quote("a", 5)], { identityFailure: true }),
      operatorUnavailable("any reason")
    ];
    for (const result of inputs) {
      expect(result.captureStatus === "captured").toBe(result.closingOdds !== null);
    }
  });

  it("never falls back to an opening price when the close is missing", () => {
    // A quote from three hours out is exactly the number a fallback would grab.
    const result = capture([quote("a", 180, 5.0)]);
    expect(result.captureStatus).toBe("no_quotes");
    expect(result.closingOdds).toBeNull();
  });
});

describe("CLV", () => {
  it("computes both series with the same sign", () => {
    // Backed at 3.0, closed at 2.5: we beat the close on both measures.
    expect(oddsClv(3.0, 2.5)).toBeCloseTo(0.2, 6);
    expect(probabilityClv(0.333, 0.4)).toBeCloseTo(0.067, 3);
  });

  it("returns null rather than zero for a missing close", () => {
    expect(oddsClv(3.0, null)).toBeNull();
    expect(probabilityClv(0.333, null)).toBeNull();
    expect(probabilityClv(null, 0.4)).toBeNull();
  });

  it("reports the uncovered count alongside every mean", () => {
    const summary = summariseClv([
      { publishedOdds: 3.0, publishedProbabilityNoVig: 0.333, closingOdds: 2.5, closingProbability: 0.4 },
      { publishedOdds: 2.0, publishedProbabilityNoVig: 0.5, closingOdds: null, closingProbability: null },
      { publishedOdds: 4.0, publishedProbabilityNoVig: 0.25, closingOdds: null, closingProbability: null }
    ]);
    expect(summary.eligible).toBe(3);
    expect(summary.odds.covered).toBe(1);
    expect(summary.odds.uncovered).toBe(2);
    // The mean is over the covered row only, and the two missing closes are
    // absent from the numerator rather than sitting in it as zeros.
    expect(summary.odds.mean).toBeCloseTo(0.2, 6);
  });

  it("reports a null mean rather than zero when nothing is covered", () => {
    const summary = summariseClv([
      { publishedOdds: 2.0, publishedProbabilityNoVig: 0.5, closingOdds: null, closingProbability: null }
    ]);
    expect(summary.odds.mean).toBeNull();
    expect(summary.odds.covered).toBe(0);
    expect(summary.odds.uncovered).toBe(1);
  });

  it("keeps the two series independent when only one is capturable", () => {
    // A close with odds but no de-viggable market: odds CLV exists, probability
    // CLV does not, and neither is invented from the other.
    const summary = summariseClv([
      { publishedOdds: 3.0, publishedProbabilityNoVig: 0.333, closingOdds: 2.5, closingProbability: null }
    ]);
    expect(summary.odds.covered).toBe(1);
    expect(summary.probability.covered).toBe(0);
    expect(summary.probability.mean).toBeNull();
  });
});
