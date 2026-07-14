import { describe, expect, it } from "vitest";
import { buildDecisionCalibrationInterval } from "@/lib/sports/prediction/decisionCalibrationInterval";
import type { DecisionLearningProfile } from "@/lib/sports/types";

function profile({
  active = true,
  sampleSize = 100,
  observedRate = 0.6
}: {
  active?: boolean;
  sampleSize?: number;
  observedRate?: number;
} = {}): DecisionLearningProfile {
  return {
    status: active ? "active" : "shadow-only",
    source: "validated-holdout",
    active,
    modelKey: "football-poisson-v2",
    engineVersion: "decision-engine-v1",
    sampleSize,
    realFinishedFixtures: sampleSize,
    minimumRecommendedFixtures: 30,
    minimumEdge: 0.03,
    valueEdgeWeight: 0.32,
    dataQualityWeight: 0.18,
    marketAdjustmentWeight: 0.14,
    homeAdvantageElo: 62,
    brierScore: 0.18,
    yield: 0.04,
    closingLineValue: 0.015,
    calibrationBuckets: [
      {
        minProbability: 0.5,
        maxProbability: 0.7,
        sampleSize,
        averageProbability: 0.58,
        observedRate,
        calibrationError: Math.abs(observedRate - 0.58)
      }
    ],
    generatedAt: "2026-07-11T00:00:00.000Z",
    reason: "Validated calibration profile.",
    notes: []
  };
}

describe("decision calibration interval", () => {
  it("computes a Wilson 95% interval from the matching settled calibration bucket", () => {
    const interval = buildDecisionCalibrationInterval({ probability: 0.58, learningProfile: profile() });
    expect(interval).toMatchObject({
      method: "wilson-calibration-bucket",
      confidenceLevel: 0.95,
      sampleSize: 100,
      source: "validated-holdout"
    });
    expect(interval.low).toBeCloseTo(0.502, 3);
    expect(interval.high).toBeCloseTo(0.691, 3);
    expect(interval.detail).toContain("100 settled predictions");
  });

  it("returns an explicit unavailable state instead of fabricating a band without active calibration", () => {
    expect(buildDecisionCalibrationInterval({ probability: 0.58, learningProfile: profile({ active: false }) })).toMatchObject({
      low: null,
      high: null,
      method: "unavailable",
      confidenceLevel: null,
      sampleSize: null,
      source: "validated-holdout"
    });
  });

  it("rejects thin matching buckets as insufficient statistical evidence", () => {
    const interval = buildDecisionCalibrationInterval({ probability: 0.58, learningProfile: profile({ sampleSize: 12 }) });
    expect(interval).toMatchObject({
      low: null,
      high: null,
      method: "unavailable",
      sampleSize: 12
    });
    expect(interval.detail).toContain("at least 30 are required");
  });
});
