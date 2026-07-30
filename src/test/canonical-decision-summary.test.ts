import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import {
  bestPickFromCanonicalDecision,
  buildCanonicalDecision,
  oddsSnapshotsFromMatch
} from "@/lib/sports/prediction/canonicalDecision";
import { toPredictionListRow } from "@/lib/sports/prediction/listRow";
import { resolveCanonicalDecisionForMatchDetail } from "@/lib/sports/prediction/decisionSnapshotIdentity";
import { buildSportsSlate, normalizeCanonicalFixture } from "@/lib/sports/intelligence/canonical";
import { buildPrediction } from "@/lib/sports/service";
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
    evidenceHash: canonicalDecision.auditSummary.evidenceHash ?? "decision-evidence-v1:test",
    markets: [],
    modelMarkets: [],
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

  it("retains the market-prior receipt in the hashed canonical summary", async () => {
    const match = await fixture();
    const built = buildPrediction(match);

    expect(built.canonicalDecision.auditSummary.marketPriorAdjustment).toEqual(built.marketPriorAdjustment);
    expect(built.canonicalDecision.auditSummary.summaryHash).toMatch(/^decision-summary-v1:fnv1a-/);
  });

  it("retains executable-price provenance in the hashed market analysis", async () => {
    const match = await fixture();
    const bookA = summary(match, bttsEdge({
      bookmaker: { id: "book-a", name: "Book A" },
      priceObservedAt: "2026-07-13T12:00:00.000Z",
      priceMethod: "best-price-per-selection-v1"
    }));
    const bookB = summary(match, bttsEdge({
      bookmaker: { id: "book-b", name: "Book B" },
      priceObservedAt: "2026-07-13T12:00:00.000Z",
      priceMethod: "best-price-per-selection-v1"
    }));

    expect(bookA.allMarketAnalyses[0]).toMatchObject({
      bookmaker: { id: "book-a", name: "Book A" },
      priceObservedAt: "2026-07-13T12:00:00.000Z",
      priceMethod: "best-price-per-selection-v1"
    });
    expect(bookA.auditSummary.summaryHash).not.toBe(bookB.auditSummary.summaryHash);
  });

  it("publishes a best-price edge only with matching source, exact time, sufficient depth, and bounded disagreement", async () => {
    const pricedAt = "2026-07-13T12:00:00.000Z";
    const match = await fixture({
      oddsMarkets: [{
        id: "both_teams_to_score",
        name: "Both teams to score",
        priceMethod: "best-price-per-selection-v1",
        selections: [
          { id: "yes", label: "BTTS Yes", decimalOdds: 1.9, bookmaker: { id: "book-a", name: "Book A" }, observedAt: pricedAt },
          { id: "no", label: "BTTS No", decimalOdds: 2.05, bookmaker: { id: "book-b", name: "Book B" }, observedAt: pricedAt }
        ]
      }]
    }, pricedAt);
    const decision = summary(match, bttsEdge({
      bookmaker: { id: "book-a", name: "Book A" },
      priceObservedAt: pricedAt,
      priceMethod: "best-price-per-selection-v1",
      consensusBookmakerCount: 5,
      consensusMaxProbabilitySpread: 0.04
    }));

    expect(decision.publicStatus).toBe("value_pick");
    expect(decision.bestPublishedPick?.publicationEligible).toBe(true);
  });

  it.each([
    {
      label: "missing selection timestamp",
      overrides: { priceObservedAt: null },
      blocker: "best-price timestamp is missing, mismatched, or ahead of the decision clock"
    },
    {
      label: "thin consensus",
      overrides: { consensusBookmakerCount: 2 },
      blocker: "best-price comparison needs at least 3 independent bookmakers"
    },
    {
      label: "disputed consensus",
      overrides: { consensusMaxProbabilitySpread: 0.14 },
      blocker: "cross-book probability disagreement exceeds 10%"
    }
  ])("keeps a positive best-price edge on the watchlist for $label", async ({ overrides, blocker }) => {
    const pricedAt = "2026-07-13T12:00:00.000Z";
    const match = await fixture({
      oddsMarkets: [{
        id: "both_teams_to_score",
        name: "Both teams to score",
        priceMethod: "best-price-per-selection-v1",
        selections: [
          { id: "yes", label: "BTTS Yes", decimalOdds: 1.9, bookmaker: { id: "book-a", name: "Book A" }, observedAt: pricedAt },
          { id: "no", label: "BTTS No", decimalOdds: 2.05, bookmaker: { id: "book-b", name: "Book B" }, observedAt: pricedAt }
        ]
      }]
    }, pricedAt);
    const decision = summary(match, bttsEdge({
      bookmaker: { id: "book-a", name: "Book A" },
      priceObservedAt: pricedAt,
      priceMethod: "best-price-per-selection-v1",
      consensusBookmakerCount: 5,
      consensusMaxProbabilitySpread: 0.04,
      ...overrides
    }));

    expect(decision.publicStatus).toBe("watchlist");
    expect(decision.bestPublishedPick).toBeNull();
    expect(decision.bestWatchlistCandidate?.blockers).toContain(blocker);
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

  // v1.1: an unavailable floor no longer blocks outright — it raises the bar.
  // A point estimate under the uncalibrated bar still earns nothing, which is
  // what this case guards; clearing that bar is covered in
  // uncalibrated-publication-gate.test.ts.
  it("keeps point-estimate value on the watchlist when it misses the uncalibrated bar", async () => {
    const decision = summary(await fixture(), bttsEdge({
      edge: 0.03,
      expectedValue: 0.03,
      economicConfidence: {
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

    expect(decision.publicStatus).toBe("watchlist");
    expect(decision.bestPublishedPick).toBeNull();
    expect(decision.bestWatchlistCandidate?.blockers.join(" | ")).toContain("uncalibrated publication needs at least 5% raw edge");
  });

  it("requires the empirical lower-bound edge and EV to clear the same publication thresholds", async () => {
    const decision = summary(await fixture(), bttsEdge({
      economicConfidence: {
        status: "verified",
        method: "wilson-calibration-bucket",
        confidenceLevel: 0.95,
        sampleSize: 500,
        source: "exact-runtime-holdout",
        probabilityLow: 0.56,
        probabilityHigh: 0.68,
        edgeLow: 0.01,
        expectedValueLow: 0.02,
        detail: "Verified but economically thin."
      }
    }));

    expect(decision.publicStatus).toBe("watchlist");
    expect(decision.bestWatchlistCandidate?.blockers).toEqual(expect.arrayContaining([
      "empirical 95% lower-bound edge is below 4%",
      "empirical 95% lower-bound EV is below 3%"
    ]));
  });

  it("does not publish a positive edge that fails the engine robustness audit", async () => {
    const decision = summary(
      await fixture(),
      bttsEdge(),
      {
        action: "consider",
        calibration: { action: "trust" },
        actionability: { status: "actionable" },
        abstentionRules: [],
        dataCoverage: { signals: [] },
        robustness: { status: "fragile" },
        uncertainty: { status: "controlled" }
      } as unknown as Prediction["decision"]
    );
    expect(decision.publicStatus).toBe("watchlist");
    expect(decision.bestPublishedPick).toBeNull();
    expect(decision.bestWatchlistCandidate?.blockers).toContain("robustness stress tests classify the recommendation as fragile");
  });

  it("does not publish while uncertainty decomposition remains high-risk", async () => {
    const decision = summary(
      await fixture(),
      bttsEdge(),
      {
        action: "consider",
        calibration: { action: "trust" },
        actionability: { status: "actionable" },
        abstentionRules: [],
        dataCoverage: { signals: [] },
        robustness: { status: "sensitive" },
        uncertainty: { status: "high-risk" }
      } as unknown as Prediction["decision"]
    );
    expect(decision.publicStatus).toBe("watchlist");
    expect(decision.bestWatchlistCandidate?.blockers).toContain("uncertainty decomposition classifies the recommendation as high-risk");
  });

  it("does not publish when a sufficiently powered exact-runtime holdout loses money", async () => {
    const decision = summary(
      await fixture(),
      bttsEdge(),
      {
        action: "consider",
        calibration: { action: "trust" },
        actionability: { status: "actionable" },
        abstentionRules: [],
        dataCoverage: { signals: [] },
        robustness: { status: "stable" },
        uncertainty: { status: "controlled" },
        learningProfile: {
          status: "shadow-only",
          source: "provider-history",
          active: false,
          modelCompatibility: "exact-runtime-parity",
          sampleSize: 1_200,
          testSize: 360,
          realFinishedFixtures: 1_200,
          minimumRecommendedFixtures: 1_000,
          minimumEdge: null,
          valueEdgeWeight: null,
          dataQualityWeight: null,
          marketAdjustmentWeight: null,
          homeAdvantageElo: null,
          brierScore: 0.2,
          yield: -0.03,
          closingLineValue: -0.01,
          generatedAt: NOW.toISOString(),
          reason: "Exact-runtime holdout failed betting-economics gates.",
          notes: []
        }
      } as unknown as Prediction["decision"]
    );

    expect(decision.publicStatus).toBe("watchlist");
    expect(decision.bestPublishedPick).toBeNull();
    expect(decision.bestWatchlistCandidate?.blockers).toEqual(
      expect.arrayContaining([
        "exact-runtime holdout yield is not positive",
        "exact-runtime closing-line value is not positive"
      ])
    );
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

  it("uses a stored match-detail headline only for the same evidence, model, and engine snapshot", async () => {
    const match = await fixture();
    const freshPrediction = buildPrediction(match);
    const storedSummary = {
      ...freshPrediction.canonicalDecision,
      generatedAt: "2026-07-13T12:00:00.000Z"
    };

    expect(resolveCanonicalDecisionForMatchDetail({ freshPrediction, storedSummary })).toBe(storedSummary);

    const incompatibleSummary = {
      ...storedSummary,
      auditSummary: {
        ...storedSummary.auditSummary,
        evidenceHash: "decision-evidence-v1:fnv1a-deadbeef"
      }
    };
    expect(resolveCanonicalDecisionForMatchDetail({ freshPrediction, storedSummary: incompatibleSummary })).toBe(
      freshPrediction.canonicalDecision
    );

    const tamperedSummary = {
      ...storedSummary,
      risk: storedSummary.risk === "high" ? "low" as const : "high" as const
    };
    expect(resolveCanonicalDecisionForMatchDetail({ freshPrediction, storedSummary: tamperedSummary })).toBe(
      freshPrediction.canonicalDecision
    );
  });

  it("rejects legacy stored summaries without atomic provenance", async () => {
    const match = await fixture();
    const freshPrediction = buildPrediction(match);
    const legacySummary = {
      ...freshPrediction.canonicalDecision,
      auditSummary: { ...freshPrediction.canonicalDecision.auditSummary }
    };
    delete legacySummary.auditSummary.evidenceHash;
    delete legacySummary.auditSummary.summaryHash;
    delete legacySummary.auditSummary.modelVersion;
    delete legacySummary.auditSummary.engineVersion;

    expect(resolveCanonicalDecisionForMatchDetail({ freshPrediction, storedSummary: legacySummary })).toBe(
      freshPrediction.canonicalDecision
    );
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

  /**
   * The watchlist candidate is what the product shows when nothing is
   * publishable — which today is every fixture. Ranking that tier by claimed
   * value hands users argmax(model − market), and the maximum of a noisy
   * difference is systematically the model's biggest overestimate: a longshot.
   * Measured on 114 settled football fixtures, that rule produced 5.37 average
   * odds, a 25.4% hit rate and −8.49 units; tipping the model's most probable
   * outcome on the identical fixtures scored 54.4% and +9.08 units. A watchlist
   * tip must therefore be the model's favorite, not its wildest disagreement.
   */
  it("fronts the model favorite on the watchlist, not the highest-EV longshot", async () => {
    const favorite = bttsEdge({
      marketId: "match_winner",
      selectionId: "home",
      label: "Home win",
      modelProbability: 0.55,
      rawImpliedProbability: 0.53,
      noVigImpliedProbability: 0.51,
      impliedProbability: 0.51,
      edge: 0.04,
      expectedValue: 0.045,
      expectedRoi: 0.045,
      odds: 1.9
    });
    const longshot = bttsEdge({
      modelProbability: 0.24,
      rawImpliedProbability: 0.17,
      noVigImpliedProbability: 0.16,
      impliedProbability: 0.16,
      edge: 0.08,
      expectedValue: 0.44,
      expectedRoi: 0.44,
      odds: 6.0
    });
    // Data quality below the floor holds both markets on the watchlist.
    const match = await fixture({ dataQualityScore: 0.5 });
    const decision = buildCanonicalDecision(
      match,
      oddsSnapshotsFromMatch(match, NOW),
      {
        valueEdges: [longshot, favorite],
        diagnostics: { dataQualityScore: match.dataQualityScore },
        generatedAt: NOW.toISOString()
      },
      [],
      { now: NOW }
    );

    expect(decision.publicStatus).toBe("watchlist");
    // The old EV-weighted ranking scored the longshot 4.8 against the
    // favorite's 0.65 and fronted it. The favorite must win this tier.
    expect(decision.bestWatchlistCandidate?.selectionId).toBe("home");
    expect(decision.bestWatchlistCandidate?.modelProbability).toBeCloseTo(0.55, 5);
    // The longshot is still analysed and visible — just not the headline tip.
    expect(decision.allMarketAnalyses.some((analysis) => analysis.selectionId === "yes")).toBe(true);
  });

  /**
   * The production regression the first fix missed: the watchlist tier only
   * admits positive-edge selections, and the model's favorite usually has
   * NEGATIVE edge against the market — so reordering the tier changed nothing
   * (displayed tips averaged 0.280 probability after that deploy, 0.303
   * before). The display candidate must reach the favorite even when its edge
   * is negative and only the longshot cleared the tier.
   */
  it("fronts a negative-edge favorite over the only positive-edge longshot", async () => {
    const negativeEdgeFavorite = bttsEdge({
      marketId: "match_winner",
      selectionId: "home",
      label: "Home win",
      modelProbability: 0.52,
      rawImpliedProbability: 0.57,
      noVigImpliedProbability: 0.55,
      impliedProbability: 0.55,
      edge: -0.03,
      expectedValue: -0.05,
      expectedRoi: -0.05,
      odds: 1.75
    });
    const positiveEdgeLongshot = bttsEdge({
      marketId: "match_winner",
      selectionId: "away",
      label: "Away win",
      modelProbability: 0.21,
      rawImpliedProbability: 0.15,
      noVigImpliedProbability: 0.14,
      impliedProbability: 0.14,
      edge: 0.07,
      expectedValue: 0.4,
      expectedRoi: 0.4,
      odds: 6.7
    });
    const match = await fixture({ dataQualityScore: 0.5 });
    const decision = buildCanonicalDecision(
      match,
      oddsSnapshotsFromMatch(match, NOW),
      {
        valueEdges: [positiveEdgeLongshot, negativeEdgeFavorite],
        diagnostics: { dataQualityScore: match.dataQualityScore },
        generatedAt: NOW.toISOString()
      },
      [],
      { now: NOW }
    );

    // The longshot sits in the watchlist tier; the favorite, with negative
    // edge, sits in no_clear_value. The displayed candidate must still be the
    // favorite.
    expect(decision.bestWatchlistCandidate?.selectionId).toBe("home");
    expect(decision.bestWatchlistCandidate?.modelProbability).toBeCloseTo(0.52, 5);
  });
});
