import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import {
  bestPickFromCanonicalDecision,
  buildCanonicalDecision,
  oddsSnapshotsFromMatch
} from "@/lib/sports/prediction/canonicalDecision";
import { toPredictionListRow } from "@/lib/sports/prediction/listRow";
import { buildSportsSlate, normalizeCanonicalFixture } from "@/lib/sports/intelligence/canonical";
import type { DecisionSummary, Match, Prediction, ValueEdge } from "@/lib/sports/types";

const NOW = new Date("2026-07-13T12:05:00.000Z");

async function fixture(overrides: Partial<Match> = {}, oddsCapturedAt = "2026-07-13T12:00:00.000Z"): Promise<Match> {
  const [base] = await mockSportsDataProvider.getFixtures("2026-07-13", "football");
  return {
    ...base,
    ...overrides,
    id: overrides.id ?? "api-football:canonical-1",
    kickoffTime: overrides.kickoffTime ?? "2026-07-13T18:00:00.000Z",
    status: overrides.status ?? "scheduled",
    dataQualityScore: overrides.dataQualityScore ?? 0.9,
    dataSource: {
      kind: "provider",
      fixtureProvider: "api-football",
      fixtureProviderId: "canonical-1",
      oddsProvider: "the-odds-api",
      oddsProviderEventId: "canonical-odds-1",
      oddsCapturedAt,
      fetchedAt: oddsCapturedAt
    }
  };
}

function bttsEdge(overrides: Partial<ValueEdge> = {}): ValueEdge {
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

function summary(match: Match, edge = bttsEdge(), decision?: Prediction["decision"]): DecisionSummary {
  return buildCanonicalDecision(
    match,
    oddsSnapshotsFromMatch(match, NOW),
    {
      valueEdges: [edge],
      diagnostics: { dataQualityScore: match.dataQualityScore },
      decision,
      generatedAt: NOW.toISOString()
    },
    [],
    { now: NOW }
  );
}

function prediction(match: Match, canonicalDecision: DecisionSummary): Prediction {
  const edge = canonicalDecision.allMarketAnalyses[0] ?? bttsEdge();
  return {
    matchId: match.id,
    sport: match.sport,
    generatedAt: canonicalDecision.generatedAt,
    markets: [],
    diagnostics: { modelVersion: "canonical-test", dataQualityScore: match.dataQualityScore } as Prediction["diagnostics"],
    contextAdjustment: {} as Prediction["contextAdjustment"],
    marketPriorAdjustment: {} as Prediction["marketPriorAdjustment"],
    valueEdges: [edge],
    canonicalDecision,
    bestPick: bestPickFromCanonicalDecision(canonicalDecision),
    confidence: canonicalDecision.confidence,
    risk: canonicalDecision.risk,
    explanation: {} as Prediction["explanation"],
    agentReport: {} as Prediction["agentReport"],
    decision: { engineVersion: "canonical-test" } as Prediction["decision"]
  };
}

describe("canonical DecisionSummary", () => {
  it("publishes fresh BTTS Yes edge +10% and EV +15% with sufficient data", async () => {
    const decision = summary(await fixture());
    expect(decision.publicStatus).toBe("value_pick");
    expect(decision.bestPublishedPick?.label).toBe("BTTS Yes");
    expect(decision.bestPublishedPick?.edge).toBeCloseTo(0.1);
    expect(decision.bestPublishedPick?.expectedValue).toBeCloseTo(0.15);
  });

  it("downgrades the same candidate when odds are stale", async () => {
    const decision = summary(await fixture({}, "2026-07-13T10:00:00.000Z"));
    expect(["watchlist", "stale"]).toContain(decision.publicStatus);
    expect(decision.publicStatus).not.toBe("value_pick");
    expect(decision.bestPublishedPick).toBeNull();
  });

  it("holds positive edge on the watchlist when data quality is below the floor", async () => {
    const decision = summary(await fixture({ dataQualityScore: 0.5 }));
    expect(decision.publicStatus).toBe("watchlist");
    expect(decision.bestWatchlistCandidate?.blockers).toContain("data quality is below the sport threshold");
  });

  it("returns no_clear_value when no market has positive edge", async () => {
    const decision = summary(await fixture(), bttsEdge({ edge: -0.02, expectedValue: -0.04, expectedRoi: -0.04 }));
    expect(decision.publicStatus).toBe("no_clear_value");
    expect(decision.bestPublishedPick).toBeNull();
    expect(decision.noPickReason).toBe("No clear value found.");
  });

  it("keeps prediction-list and detail projections on the same canonical object", async () => {
    const match = await fixture();
    const canonicalDecision = summary(match);
    const fullPrediction = prediction(match, canonicalDecision);
    const listRow = toPredictionListRow({ match, prediction: fullPrediction });
    expect(listRow.prediction.canonicalDecision).toEqual(fullPrediction.canonicalDecision);
    expect(listRow.prediction.bestPick).toEqual(bestPickFromCanonicalDecision(fullPrediction.canonicalDecision));
  });

  it("places canonical value picks in the value-picks slate group", async () => {
    const match = await fixture();
    const canonicalDecision = summary(match);
    const canonicalFixture = normalizeCanonicalFixture(match, NOW);
    const slate = buildSportsSlate({
      scope: "daily",
      fixtures: [canonicalFixture],
      oddsByFixture: new Map(),
      decisionsByFixture: new Map(),
      decisionSummariesByFixture: new Map([[match.id, canonicalDecision]]),
      range: { from: "2026-07-13", to: "2026-07-13" },
      providerStatus: "completed",
      generatedAt: NOW.toISOString()
    });
    expect(slate.groups.valuePicks).toHaveLength(1);
    expect(slate.groups.valuePicks[0]?.decisionSummary).toEqual(canonicalDecision);
  });

  it("does not let a debug agent candidate override the canonical decision", async () => {
    const match = await fixture();
    const debugDecision = {
      action: "consider",
      oddsIntelligence: { bestActionableSelection: bttsEdge({ edge: 0.2, expectedValue: 0.3 }) }
    } as unknown as Prediction["decision"];
    const canonicalDecision = summary(
      match,
      bttsEdge({ edge: -0.02, expectedValue: -0.04, expectedRoi: -0.04 }),
      debugDecision
    );
    const fullPrediction = prediction(match, canonicalDecision);
    expect(canonicalDecision.publicStatus).toBe("no_clear_value");
    expect(fullPrediction.canonicalDecision.bestPublishedPick).toBeNull();
    expect(fullPrediction.bestPick.hasValue).toBe(false);
  });

  it("never contradicts published status and market-analysis eligibility", async () => {
    const decisions = [
      summary(await fixture({ id: "api-football:invariant-value" })),
      summary(await fixture({ id: "api-football:invariant-none" }), bttsEdge({ edge: -0.01, expectedValue: -0.02, expectedRoi: -0.02 })),
      summary(await fixture({ id: "api-football:invariant-watch", dataQualityScore: 0.4 }))
    ];
    for (const decision of decisions) {
      const hasPublishedAnalysis = decision.allMarketAnalyses.some((analysis) => analysis.analysisStatus === "published_value_pick");
      expect(decision.publicStatus === "value_pick").toBe(hasPublishedAnalysis);
      expect(decision.auditSummary.publicInvariantPassed).toBe(true);
    }
  });
});
