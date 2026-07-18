import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionPriceSignal } from "@/components/odds/DecisionPriceSignal";

describe("decision price signal", () => {
  it("makes the full model-versus-market price case readable in one component", () => {
    const html = renderToStaticMarkup(createElement(DecisionPriceSignal, {
      modelProbability: 0.56,
      marketProbability: 0.49,
      currentOdds: 2.04,
      edge: 0.07,
      expectedValue: 0.1424
    }));

    expect(html).toContain("Price case");
    expect(html).toContain("Model versus consensus and executable price");
    expect(html).toContain("56%");
    expect(html).toContain("49%");
    expect(html).toContain("Fair odds");
    expect(html).toContain("1.79");
    expect(html).toContain("Quoted odds");
    expect(html).toContain("2.04");
    expect(html).toContain("Probability edge");
    expect(html).toContain("+7.0%");
    expect(html).toContain("Expected value");
    expect(html).toContain("+14.2%");
    expect(html).toContain("Quote provenance incomplete");
    expect(html).toContain("Market depth unavailable");
  });

  it("separates a broad consensus prior from the executable quote", () => {
    const html = renderToStaticMarkup(createElement(DecisionPriceSignal, {
      modelProbability: 0.56,
      marketProbability: 0.49,
      currentOdds: 2.04,
      edge: 0.07,
      expectedValue: 0.1424,
      marketPriorReceipt: {
        marketId: "draw_no_bet",
        selectionCount: 2,
        bookmakerMargin: 0.035,
        weight: 0.18,
        priorMethod: "median-no-vig-v1",
        bookmakerCount: 5,
        maxProbabilitySpread: 0.02
      }
    }));

    expect(html).toContain("Broad market agreement");
    expect(html).toContain("5 bookmakers / 2% widest probability gap");
    expect(html).toContain("18% prior influence");
    expect(html).toContain("named bookmaker quote remains a separate executable price");
  });

  it("names the bookmaker and timestamp behind a shopped executable quote", () => {
    const html = renderToStaticMarkup(createElement(DecisionPriceSignal, {
      modelProbability: 0.56,
      marketProbability: 0.49,
      currentOdds: 2.08,
      edge: 0.07,
      expectedValue: 0.1648,
      executionPriceReceipt: {
        bookmaker: { id: "book-b", name: "Book B" },
        priceObservedAt: "2026-07-18T08:02:00Z",
        priceMethod: "best-price-per-selection-v1"
      },
      publicationGateReceipt: {
        analysisStatus: "watchlist",
        publicationEligible: false,
        blockers: ["decimal odds are outside the publication range"],
        expiresAt: "2026-07-18T09:00:00Z"
      },
      economicConfidenceReceipt: {
        status: "unavailable",
        method: "unavailable",
        confidenceLevel: null,
        sampleSize: null,
        source: null,
        probabilityLow: null,
        probabilityHigh: null,
        edgeLow: null,
        expectedValueLow: null,
        detail: "No active exact-runtime calibration profile."
      }
    }));

    expect(html).toContain("Best executable quote");
    expect(html).toContain("Book B");
    expect(html).toContain("18 Jul");
    expect(html).toContain("08:02");
    expect(html).toContain("consensus probability is calculated separately");
    expect(html).toContain("Analysis only — publication blocked");
    expect(html).toContain("Decimal odds are outside the publication range.");
    expect(html).toContain("Empirical value floor unavailable");
    expect(html).toContain("Raw EV remains a point estimate");
  });

  it("does not style a negative price case as positive", () => {
    const html = renderToStaticMarkup(createElement(DecisionPriceSignal, {
      modelProbability: 0.44,
      marketProbability: 0.5,
      currentOdds: 1.9,
      edge: -0.06,
      expectedValue: -0.164
    }));

    expect(html).toContain("class=\"negative\"");
    expect(html).toContain("-6.0%");
    expect(html).toContain("-16.4%");
  });
});
