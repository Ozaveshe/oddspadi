import { describe, expect, it } from "vitest";
import {
  buildMarketPriorPresentation,
  marketPriorReceiptFor,
  type MarketPriorReceipt
} from "@/lib/sports/prediction/marketPriorPresentation";

function receipt(overrides: Partial<MarketPriorReceipt> = {}): MarketPriorReceipt {
  return {
    marketId: "match_winner",
    selectionCount: 3,
    bookmakerMargin: 0.04,
    weight: 0.16,
    priorMethod: "median-no-vig-v1",
    bookmakerCount: 4,
    maxProbabilitySpread: 0.04,
    ...overrides
  };
}

describe("market-prior presentation", () => {
  it("classifies broad, supported, disputed, and missing evidence without certainty claims", () => {
    expect(buildMarketPriorPresentation(receipt({ bookmakerCount: 5, maxProbabilitySpread: 0.02 })).state).toBe("broad");
    expect(buildMarketPriorPresentation(receipt()).state).toBe("supported");
    expect(buildMarketPriorPresentation(receipt({ maxProbabilitySpread: 0.14 })).state).toBe("disputed");
    expect(buildMarketPriorPresentation(null)).toMatchObject({ state: "missing", influenceLabel: null });
  });

  it("labels a one-book fallback as a reference rather than consensus", () => {
    expect(buildMarketPriorPresentation(receipt({
      priorMethod: "selected-quote-no-vig",
      bookmakerCount: 1,
      maxProbabilitySpread: null
    }))).toMatchObject({
      state: "single",
      label: "Single-book reference",
      detail: expect.stringContaining("no cross-book agreement is claimed")
    });
  });

  it("selects only the receipt for the displayed market", () => {
    const winner = receipt();
    const totals = receipt({ marketId: "over_under_25" });
    expect(marketPriorReceiptFor({
      applied: true,
      weightScale: 1,
      adjustedMarkets: 2,
      adjustedSelections: 5,
      averageWeight: 0.16,
      averageBookmakerMargin: 0.04,
      markets: [winner, totals],
      notes: []
    }, "over_under_25")).toEqual(totals);
  });
});
