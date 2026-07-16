import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DailyTipsSections } from "@/components/odds/IntelligenceSlate";
import { PredictionDisclaimer } from "@/components/odds/PredictionDisclaimer";
import type { ProviderRunStatus, SportsSlate } from "@/lib/sports/intelligence/types";
import { buildDailyTipsProduct } from "@/lib/sports/tips/product";

function emptyProduct(status: ProviderRunStatus) {
  const slate: SportsSlate = {
    scope: "daily",
    generatedAt: "2026-07-16T04:00:00.000Z",
    range: { from: "2026-07-16", to: "2026-07-16" },
    provider: { status, providers: [], lastRun: null, errors: [] },
    summary: {
      fixturesFound: 0,
      predictionsGenerated: 0,
      valuePicksPublished: 0,
      leansPublished: 0,
      watchlist: 0,
      noPickMatches: 0,
      preliminaryDecisions: 0,
      readyDecisions: 0,
      staleDecisions: 0,
      settledFixtures: 0,
      oddsSnapshotsUsed: 0
    },
    fixtures: [],
    groupedByDate: [],
    groups: { valuePicks: [], leans: [], watchlist: [], allAnalysed: [], noPicks: [] }
  };
  return buildDailyTipsProduct(slate);
}

describe("prediction empty states", () => {
  it("distinguishes a failed stored receipt from a genuine provider-empty slate", () => {
    const html = renderToStaticMarkup(createElement(DailyTipsSections, { product: emptyProduct("failed") }));

    expect(html).toContain("could not read the latest stored provider response");
    expect(html).toContain("does not mean the upstream provider returned no fixtures");
    expect(html).toContain("Not read");
  });

  it("keeps the provider-empty explanation when the receipt is readable", () => {
    const html = renderToStaticMarkup(createElement(DailyTipsSections, { product: emptyProduct("empty") }));

    expect(html).toContain("The provider returned no fixtures for today");
    expect(html).toContain("0 provider rows");
  });

  it("uses the selected sport in the shared prediction disclaimer", () => {
    const html = renderToStaticMarkup(createElement(PredictionDisclaimer, { sport: "tennis" }));

    expect(html).toContain("tennis is unpredictable");
    expect(html).not.toContain("football is unpredictable");
  });
});
