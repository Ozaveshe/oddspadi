import { describe, expect, it } from "vitest";
import { buildValueEdgeEconomicConfidence } from "@/lib/sports/prediction/valueEdgeEconomicConfidence";
import { selectBestPick } from "@/lib/sports/prediction/odds";
import type { DecisionLearningProfile, ValueEdge } from "@/lib/sports/types";

function profile(active = true): DecisionLearningProfile {
  return {
    status: active ? "active" : "shadow-only",
    source: "exact-runtime-holdout",
    active,
    modelCompatibility: "exact-runtime-parity",
    calibrationPromotion: {
      id: "promotion-1",
      candidateId: "candidate-1",
      approvedAt: "2026-07-17T00:00:00Z",
      expiresAt: null
    },
    calibrationBucketSource: "promoted-cohort",
    sampleSize: 1_200,
    realFinishedFixtures: 1_200,
    minimumRecommendedFixtures: 1_000,
    minimumEdge: 0.03,
    valueEdgeWeight: 0.32,
    dataQualityWeight: 0.18,
    marketAdjustmentWeight: 0.14,
    homeAdvantageElo: 62,
    brierScore: 0.17,
    yield: 0.04,
    closingLineValue: 0.012,
    calibrationBuckets: [{
      minProbability: 0.5,
      maxProbability: 0.7,
      sampleSize: 400,
      averageProbability: 0.61,
      observedRate: 0.68,
      calibrationError: 0.07
    }],
    generatedAt: "2026-07-18T00:00:00Z",
    reason: "Exact-runtime profile.",
    notes: []
  };
}

function edge(label: string, expectedValue: number, economicConfidence: ValueEdge["economicConfidence"]): ValueEdge {
  return {
    marketId: "match_winner",
    selectionId: label.toLowerCase().replaceAll(" ", "-"),
    label,
    modelProbability: 0.6,
    rawImpliedProbability: 0.5,
    noVigImpliedProbability: 0.5,
    impliedProbability: 0.5,
    bookmakerMargin: 0.04,
    edge: 0.1,
    expectedValue,
    expectedRoi: expectedValue,
    odds: 2,
    confidence: "medium",
    risk: "medium",
    economicConfidence
  };
}

describe("value-edge empirical economic confidence", () => {
  it("turns an active calibration bucket into a conservative 95% edge and EV floor", () => {
    const receipt = buildValueEdgeEconomicConfidence({
      modelProbability: 0.6,
      noVigImpliedProbability: 0.5,
      odds: 2,
      learningProfile: profile()
    });

    expect(receipt).toMatchObject({
      status: "verified",
      method: "wilson-calibration-bucket",
      confidenceLevel: 0.95,
      sampleSize: 400,
      source: "calibration-promotion:promotion-1/candidate:candidate-1"
    });
    expect(receipt.probabilityLow).toBeGreaterThan(0.63);
    expect(receipt.edgeLow).toBeGreaterThan(0.13);
    expect(receipt.expectedValueLow).toBeGreaterThan(0.26);
  });

  it("keeps the value floor unavailable without an active model-matched calibration profile", () => {
    expect(buildValueEdgeEconomicConfidence({
      modelProbability: 0.6,
      noVigImpliedProbability: 0.5,
      odds: 2,
      learningProfile: profile(false)
    })).toMatchObject({
      status: "unavailable",
      method: "unavailable",
      probabilityLow: null,
      edgeLow: null,
      expectedValueLow: null
    });
  });

  it("does not select a larger raw EV whose verified lower-bound economics are negative", () => {
    const fragile = edge("Fragile raw EV", 0.3, {
      status: "verified",
      method: "wilson-calibration-bucket",
      confidenceLevel: 0.95,
      sampleSize: 300,
      source: "holdout",
      probabilityLow: 0.47,
      probabilityHigh: 0.61,
      edgeLow: -0.03,
      expectedValueLow: -0.06,
      detail: "Lower-bound case fails."
    });
    const robust = edge("Robust smaller EV", 0.12, {
      status: "verified",
      method: "wilson-calibration-bucket",
      confidenceLevel: 0.95,
      sampleSize: 500,
      source: "holdout",
      probabilityLow: 0.55,
      probabilityHigh: 0.64,
      edgeLow: 0.05,
      expectedValueLow: 0.1,
      detail: "Lower-bound case survives."
    });

    expect(selectBestPick([fragile, robust])).toMatchObject({ hasValue: true, label: "Robust smaller EV" });
  });
});
