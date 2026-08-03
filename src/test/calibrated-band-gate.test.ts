import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildCanonicalDecision, oddsSnapshotsFromMatch } from "@/lib/sports/prediction/canonicalDecision";
import type { BandEvidence } from "@/lib/accumulator/calibratedBands";
import type { Match, ValueEdge } from "@/lib/sports/types";

/**
 * The band gate, exercised through the real decision builder.
 *
 * `calibratedBands.ts` was unit-tested in isolation, which proved the rule but
 * not that anything used it — the decision path still ran the fixed
 * 1.20-5.00 window and the three-book floor. These tests go through
 * `buildCanonicalDecision`, so they fail if the wiring is removed.
 */
const NOW = new Date("2026-07-13T12:05:00.000Z");

/** The bands production measured on 2026-08-03 against 932 tennis outcomes. */
const REAL_BANDS: BandEvidence[] = [
  { lowerBound: 0.0, upperBound: 0.1, settledSize: 1, calibrationGap: 0.959 },
  { lowerBound: 0.1, upperBound: 0.2, settledSize: 7, calibrationGap: 0.259 },
  { lowerBound: 0.2, upperBound: 0.3, settledSize: 77, calibrationGap: 0.063 },
  { lowerBound: 0.3, upperBound: 0.4, settledSize: 162, calibrationGap: 0.065 },
  { lowerBound: 0.4, upperBound: 0.5, settledSize: 217, calibrationGap: 0.007 },
  { lowerBound: 0.5, upperBound: 0.6, settledSize: 221, calibrationGap: 0.024 },
  { lowerBound: 0.6, upperBound: 0.7, settledSize: 162, calibrationGap: 0.034 },
  { lowerBound: 0.7, upperBound: 0.8, settledSize: 77, calibrationGap: 0.024 },
  { lowerBound: 0.8, upperBound: 0.9, settledSize: 7, calibrationGap: 0.259 },
  { lowerBound: 0.9, upperBound: 1.0, settledSize: 1, calibrationGap: 0.959 }
];

async function fixture(): Promise<Match> {
  const [base] = await mockSportsDataProvider.getFixtures("2026-07-13", "football");
  return {
    ...base,
    id: "api-football:band-1",
    kickoffTime: "2026-07-13T18:00:00.000Z",
    status: "scheduled",
    dataQualityScore: 0.9,
    dataSource: {
      kind: "provider",
      fixtureProvider: "api-football",
      fixtureProviderId: "band-1",
      oddsProvider: "the-odds-api",
      oddsProviderEventId: "band-odds-1",
      oddsCapturedAt: "2026-07-13T12:00:00.000Z",
      fetchedAt: "2026-07-13T12:00:00.000Z"
    }
  };
}

function edge(overrides: Partial<ValueEdge> = {}): ValueEdge {
  return {
    marketId: "both_teams_to_score",
    selectionId: "yes",
    label: "BTTS Yes",
    modelProbability: 0.65,
    rawImpliedProbability: 0.57,
    noVigImpliedProbability: 0.55,
    impliedProbability: 0.55,
    bookmakerMargin: 0.06,
    edge: 0.1,
    expectedValue: 0.15,
    expectedRoi: 0.15,
    odds: 1.9,
    confidence: "medium",
    risk: "medium",
    ...overrides
  };
}

async function decide(valueEdge: ValueEdge, bands?: BandEvidence[]) {
  const match = await fixture();
  return buildCanonicalDecision(
    match,
    oddsSnapshotsFromMatch(match, NOW),
    {
      valueEdges: [valueEdge],
      diagnostics: { dataQualityScore: match.dataQualityScore },
      generatedAt: NOW.toISOString()
    },
    [],
    { now: NOW, calibrationBands: bands }
  );
}

function blockersOf(summary: Awaited<ReturnType<typeof decide>>): string[] {
  return summary.allMarketAnalyses.flatMap((analysis) => analysis.blockers);
}

describe("the price bound is derived, not declared", () => {
  it("blocks an unmeasured short price and says why", async () => {
    // 0.86 lands in p80-90: seven settled outcomes behind it.
    const summary = await decide(edge({ modelProbability: 0.86, odds: 1.15, noVigImpliedProbability: 0.8 }), REAL_BANDS);
    const blockers = blockersOf(summary);
    expect(blockers.some((b) => b.includes("probability band is not publishable"))).toBe(true);
    // The reason must name the evidence, not a price range.
    expect(blockers.join(" ")).toContain("7 settled outcome");
  });

  it("admits the same price once the band has sample", async () => {
    // The whole point of deriving it: the bound moves when evidence lands.
    const earned = REAL_BANDS.map((band) =>
      band.lowerBound === 0.8 ? { ...band, settledSize: 140, calibrationGap: 0.02 } : band
    );
    const summary = await decide(edge({ modelProbability: 0.86, odds: 1.15, noVigImpliedProbability: 0.8 }), earned);
    expect(blockersOf(summary).some((b) => b.includes("probability band is not publishable"))).toBe(false);
  });

  it("keeps the fixed window when no profile exists", async () => {
    // An uncalibrated runtime must stay conservative rather than open up.
    const summary = await decide(edge({ modelProbability: 0.86, odds: 1.15, noVigImpliedProbability: 0.8 }));
    expect(blockersOf(summary).some((b) => b.includes("outside the publication range"))).toBe(true);
  });

  it("still blocks the longshot tail", async () => {
    const summary = await decide(edge({ modelProbability: 0.15, odds: 7.5, noVigImpliedProbability: 0.1 }), REAL_BANDS);
    expect(blockersOf(summary).some((b) => b.includes("probability band is not publishable"))).toBe(true);
  });

  it("passes a well-measured mid-band price", async () => {
    const summary = await decide(edge({ modelProbability: 0.55, odds: 2.0, noVigImpliedProbability: 0.48 }), REAL_BANDS);
    expect(blockersOf(summary).some((b) => b.includes("probability band"))).toBe(false);
  });
});

describe("the bookmaker panel is priced, not gated", () => {
  it("lets a single-book selection through on a bigger edge", async () => {
    // The hard floor of three rejected these outright — 13.9% of decisions
    // that were otherwise good enough to publish.
    const summary = await decide(
      edge({
        modelProbability: 0.55,
        odds: 2.0,
        noVigImpliedProbability: 0.45,
        edge: 0.1,
        priceMethod: "best-price-per-selection-v1",
        consensusBookmakerCount: 1,
        consensusMaxProbabilitySpread: 0.02
      } as Partial<ValueEdge>),
      REAL_BANDS
    );
    expect(blockersOf(summary).some((b) => b.includes("bookmaker panel needs") || b.includes("independent bookmakers"))).toBe(false);
  });

  it("refuses a single book when the edge does not cover the premium", async () => {
    const summary = await decide(
      edge({
        modelProbability: 0.55,
        odds: 2.0,
        noVigImpliedProbability: 0.535,
        edge: 0.015,
        priceMethod: "best-price-per-selection-v1",
        consensusBookmakerCount: 1,
        consensusMaxProbabilitySpread: 0.02
      } as Partial<ValueEdge>),
      REAL_BANDS
    );
    expect(blockersOf(summary).some((b) => b.includes("1-bookmaker panel needs"))).toBe(true);
  });

  it("refuses when there is no price at all", async () => {
    const summary = await decide(
      edge({
        modelProbability: 0.55,
        odds: 2.0,
        noVigImpliedProbability: 0.45,
        edge: 0.1,
        priceMethod: "best-price-per-selection-v1",
        consensusBookmakerCount: 0,
        consensusMaxProbabilitySpread: 0.02
      } as Partial<ValueEdge>),
      REAL_BANDS
    );
    expect(blockersOf(summary).some((b) => b.includes("no bookmaker price"))).toBe(true);
  });
});
