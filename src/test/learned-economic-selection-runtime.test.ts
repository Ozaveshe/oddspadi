import { describe, expect, it } from "vitest";

import { selectBestPick } from "@/lib/sports/prediction/odds";
import type { DecisionLearningProfile, ValueEdge } from "@/lib/sports/types";

function edge(confidence: "medium" | "high", expectedValue: number): ValueEdge {
  return {
    marketId: "match_winner",
    selectionId: confidence,
    label: confidence,
    modelProbability: 0.6,
    rawImpliedProbability: 0.5,
    noVigImpliedProbability: 0.5,
    impliedProbability: 0.5,
    bookmakerMargin: 0.04,
    edge: 0.1,
    expectedValue,
    expectedRoi: expectedValue,
    odds: 2,
    confidence,
    risk: confidence === "high" ? "low" : "medium"
  };
}

function profile(allowedConfidenceBands: Array<"low" | "medium" | "high">): DecisionLearningProfile {
  return {
    status: "active",
    source: "runtime-replay",
    active: true,
    sampleSize: 1200,
    realFinishedFixtures: 1200,
    minimumRecommendedFixtures: 1000,
    minimumEdge: 0.035,
    valueEdgeWeight: null,
    dataQualityWeight: null,
    marketAdjustmentWeight: null,
    homeAdvantageElo: null,
    economicSelectionPolicyStatus: "active",
    allowedConfidenceBands,
    brierScore: 0.19,
    yield: 0.04,
    closingLineValue: 0.02,
    generatedAt: "2026-07-17T00:00:00.000Z",
    reason: "governed",
    notes: []
  };
}

describe("learned economic policy at live pick selection", () => {
  it("can select a proven medium band while rejecting a more confident but excluded price", () => {
    const result = selectBestPick([edge("high", 0.3), edge("medium", 0.12)], {
      learningProfile: profile(["medium"])
    });

    expect(result.hasValue).toBe(true);
    expect(result.hasValue && result.confidence).toBe("medium");
  });

  it("abstains when the governed policy allows no confidence band", () => {
    const result = selectBestPick([edge("high", 0.3), edge("medium", 0.12)], {
      learningProfile: profile([])
    });

    expect(result).toEqual({ hasValue: false, label: "No clear value found" });
  });
});
