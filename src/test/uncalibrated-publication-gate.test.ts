import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildCanonicalDecision, oddsSnapshotsFromMatch } from "@/lib/sports/prediction/canonicalDecision";
import type { Match, ValueEdge, ValueEdgeEconomicConfidence } from "@/lib/sports/types";

const NOW = new Date("2026-07-13T12:05:00.000Z");

async function fixture(): Promise<Match> {
  const [base] = await mockSportsDataProvider.getFixtures("2026-07-13", "football");
  return {
    ...base,
    id: "api-football:uncalibrated-1",
    kickoffTime: "2026-07-13T18:00:00.000Z",
    status: "scheduled",
    dataQualityScore: 0.9,
    dataSource: {
      kind: "provider",
      fixtureProvider: "api-football",
      fixtureProviderId: "uncalibrated-1",
      oddsProvider: "the-odds-api",
      oddsProviderEventId: "uncalibrated-odds-1",
      oddsCapturedAt: "2026-07-13T12:00:00.000Z",
      fetchedAt: "2026-07-13T12:00:00.000Z"
    }
  };
}

/** No calibration profile has been promoted, so there is no empirical floor. */
function unavailableFloor(): ValueEdgeEconomicConfidence {
  return {
    status: "unavailable",
    method: "unavailable",
    confidenceLevel: 0.95,
    sampleSize: 0,
    source: "unavailable",
    probabilityLow: null,
    probabilityHigh: null,
    edgeLow: null,
    expectedValueLow: null,
    detail: "No promoted calibration profile exists for this runtime."
  } as ValueEdgeEconomicConfidence;
}

function edgeWith(overrides: Partial<ValueEdge>): ValueEdge {
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

async function decide(edge: ValueEdge) {
  const match = await fixture();
  return buildCanonicalDecision(
    match,
    oddsSnapshotsFromMatch(match, NOW),
    { valueEdges: [edge], diagnostics: { dataQualityScore: match.dataQualityScore }, generatedAt: NOW.toISOString() },
    [],
    { now: NOW }
  );
}

describe("uncalibrated publication gate", () => {
  it("publishes a large raw edge while no calibration profile exists", async () => {
    // Football's uncalibrated bar is 8% edge / 6% EV; this clears both.
    const decision = await decide(edgeWith({ edge: 0.1, expectedValue: 0.15, economicConfidence: unavailableFloor() }));

    expect(decision.publicStatus).toBe("value_pick");
    expect(decision.bestPublishedPick?.label).toBe("BTTS Yes");
  });

  it("still withholds an edge that clears the calibrated bar but not the uncalibrated one", async () => {
    // 5% edge would publish with a promoted profile (4% bar) but not without one.
    const decision = await decide(edgeWith({ edge: 0.05, expectedValue: 0.05, economicConfidence: unavailableFloor() }));

    expect(decision.publicStatus).not.toBe("value_pick");
    expect(decision.allMarketAnalyses[0]?.analysisStatus).toBe("watchlist");
  });

  it("names the uncalibrated bar in the blocker rather than the old dead-end message", async () => {
    const decision = await decide(edgeWith({ edge: 0.05, expectedValue: 0.05, economicConfidence: unavailableFloor() }));
    const blockers = decision.auditSummary.blockers.join(" | ");

    expect(blockers).toContain("uncalibrated publication needs at least 8% raw edge");
    expect(blockers).not.toContain("empirical 95% value floor is unavailable");
  });

  it("withholds an implausibly large edge as a model fault rather than value", async () => {
    // Production tennis was producing a 20.9% average edge with a 57.4% peak
    // while uncalibrated. An edge that size against a priced market is far more
    // likely to mean the model is wrong than that the market is.
    const decision = await decide(edgeWith({ edge: 0.35, expectedValue: 0.4, economicConfidence: unavailableFloor() }));

    expect(decision.publicStatus).not.toBe("value_pick");
    expect(decision.auditSummary.blockers.join(" | ")).toContain("plausibility ceiling");
  });

  it("keeps blocking when a calibration profile exists and the pick fails its floor", async () => {
    const verifiedButFailing: ValueEdgeEconomicConfidence = {
      status: "verified",
      method: "wilson-calibration-bucket",
      confidenceLevel: 0.95,
      sampleSize: 120,
      source: "settled-outcomes",
      probabilityLow: 0.5,
      probabilityHigh: 0.7,
      // Empirically measured floor sits below the sport's minimum value edge.
      edgeLow: 0.001,
      expectedValueLow: 0.001,
      detail: "Empirical floor measured."
    } as ValueEdgeEconomicConfidence;

    const decision = await decide(edgeWith({ edge: 0.2, expectedValue: 0.3, economicConfidence: verifiedButFailing }));

    // A big raw edge must not override a measured floor that says otherwise.
    expect(decision.publicStatus).not.toBe("value_pick");
  });
});
