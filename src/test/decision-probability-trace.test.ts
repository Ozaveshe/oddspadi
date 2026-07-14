import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";
import type { DecisionLearningProfile, Match } from "@/lib/sports/types";

function activeCalibrationProfile(): DecisionLearningProfile {
  return {
    status: "active",
    source: "validated-holdout",
    active: true,
    modelKey: "football-poisson-v2",
    engineVersion: "decision-engine-v1",
    sampleSize: 1200,
    realFinishedFixtures: 1200,
    minimumRecommendedFixtures: 1000,
    minimumEdge: 0.03,
    valueEdgeWeight: 0.32,
    dataQualityWeight: 0.18,
    marketAdjustmentWeight: 0.14,
    homeAdvantageElo: 62,
    brierScore: 0.18,
    yield: 0.04,
    closingLineValue: 0.015,
    calibrationBuckets: [
      { minProbability: 0, maxProbability: 0.3, sampleSize: 1300, averageProbability: 0.2, observedRate: 0.17, calibrationError: 0.03 },
      { minProbability: 0.3, maxProbability: 0.7, sampleSize: 1500, averageProbability: 0.5, observedRate: 0.44, calibrationError: 0.06 },
      { minProbability: 0.7, maxProbability: 1, sampleSize: 900, averageProbability: 0.78, observedRate: 0.73, calibrationError: 0.05 }
    ],
    generatedAt: "2026-07-11T00:00:00.000Z",
    reason: "Validated calibration profile.",
    notes: []
  };
}

function winnerOnlyMatch(match: Match): Match {
  return {
    ...match,
    dataSource: {
      kind: "provider",
      fixtureProvider: "api-football",
      oddsProvider: "the-odds-api",
      formProvider: "api-football-recent-fixtures",
      strengthProvider: "api-football",
      fetchedAt: "2026-07-14T12:00:00.000Z"
    },
    oddsMarkets: [
      {
        id: "match_winner",
        name: "Match winner",
        selections: [
          { id: "home", label: match.homeTeam.name, decimalOdds: 3 },
          { id: "draw", label: "Draw", decimalOdds: 3 },
          { id: "away", label: match.awayTeam.name, decimalOdds: 3 }
        ]
      }
    ]
  };
}

function tracedValueEdge(prediction: ReturnType<typeof buildPrediction>) {
  const trace = prediction.decision.probabilityTrace;
  return prediction.valueEdges.find((edge) => edge.marketId === trace.marketId && edge.label === trace.selection);
}

describe("decision probability runtime trace", () => {
  it("publishes the exact probability, edge, and EV used by selection ranking", async () => {
    const [fixture] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const prediction = buildPrediction(winnerOnlyMatch(fixture));
    const trace = prediction.decision.probabilityTrace;
    const selectedEdge = tracedValueEdge(prediction);
    expect(selectedEdge).toBeDefined();
    if (!selectedEdge) return;
    expect(trace.posteriorProbability).toBeCloseTo(selectedEdge.modelProbability, 12);
    expect(trace.modelProbability).toBeCloseTo(selectedEdge.modelProbability, 12);
    expect(trace.posteriorEdge).toBeCloseTo(selectedEdge.edge, 12);
    expect(trace.posteriorExpectedValue).toBeCloseTo(selectedEdge.expectedValue, 12);
    expect(trace.disagreement).toBeCloseTo(selectedEdge.edge, 12);
    expect(prediction.decision.beliefState.confidenceInterval).toMatchObject({
      low: null,
      high: null,
      method: "unavailable"
    });
    expect(trace.confidenceBand).toEqual({ low: null, high: null });

    const finalRuntimeStage = trace.steps.find((step) => step.id === "market-calibration");
    expect(finalRuntimeStage?.posteriorProbability).toBeCloseTo(selectedEdge.modelProbability, 12);
    expect(trace.steps.find((step) => step.id === "posterior")).toMatchObject({
      priorProbability: selectedEdge.modelProbability,
      posteriorProbability: selectedEdge.modelProbability,
      probabilityDelta: 0
    });
  });

  it("replays promoted calibration and market blending once, in runtime order", async () => {
    const [fixture] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const prediction = buildPrediction(winnerOnlyMatch(fixture), { learningProfile: activeCalibrationProfile() });
    expect(prediction.calibrationAdjustment?.status).toBe("applied");
    const trace = prediction.decision.probabilityTrace;
    const selectedEdge = tracedValueEdge(prediction);
    expect(selectedEdge).toBeDefined();
    if (!selectedEdge) return;
    const ids = trace.steps.map((step) => step.id);
    expect(ids).toEqual([
      "model-evidence",
      "context-evidence",
      "learned-calibration",
      "market-calibration",
      "market-prior",
      "posterior"
    ]);
    expect(trace.steps.find((step) => step.id === "learned-calibration")?.posteriorProbability).not.toBeNull();
    expect(prediction.decision.beliefState.confidenceInterval).toMatchObject({
      method: "wilson-calibration-bucket",
      confidenceLevel: 0.95
    });
    expect(trace.confidenceBand).toEqual({
      low: prediction.decision.beliefState.confidenceInterval.low,
      high: prediction.decision.beliefState.confidenceInterval.high
    });
    expect(trace.steps.find((step) => step.id === "market-calibration")?.posteriorProbability).toBeCloseTo(
      selectedEdge.modelProbability,
      12
    );
    const modelBaseline = trace.steps.find((step) => step.id === "model-evidence")?.posteriorProbability;
    const runtimeDeltas = trace.steps
      .filter((step) => ["context-evidence", "learned-calibration", "market-calibration"].includes(step.id))
      .reduce((sum, step) => sum + (step.probabilityDelta ?? 0), 0);
    expect(modelBaseline).not.toBeNull();
    expect((modelBaseline ?? 0) + runtimeDeltas).toBeCloseTo(selectedEdge.modelProbability, 12);
    expect(ids).not.toEqual(expect.arrayContaining(["case-memory", "abstention"]));
  });

  it("lets decision gates block an action without rewriting its probability", async () => {
    const [fixture] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const prediction = buildPrediction(winnerOnlyMatch(fixture));
    const selectedEdge = tracedValueEdge(prediction);
    expect(selectedEdge).toBeDefined();
    if (!selectedEdge) return;
    expect(prediction.decision.probabilityTrace.posteriorProbability).toBeCloseTo(selectedEdge.modelProbability, 12);
    if (prediction.decision.abstentionRules.some((rule) => rule.triggered) || prediction.decision.action === "avoid") {
      expect(prediction.decision.probabilityTrace.status).toBe("blocked");
    }
    expect(prediction.decision.probabilityTrace.safeguards.join(" ")).toContain("cannot mutate the published probability");
  });
});
