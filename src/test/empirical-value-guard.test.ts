import { describe, expect, it } from "vitest";
import {
  evaluateEmpiricalValueGuard,
  learnEmpiricalValueGuardPolicy
} from "@/lib/sports/prediction/empiricalValueGuard";
import { selectBestPick } from "@/lib/sports/prediction/odds";
import type { DecisionLearningProfile, ValueEdge } from "@/lib/sports/types";

function rows(count = 100, sameKickoff = false) {
  return Array.from({ length: count }, (_, index) => ({
    kickoffAt: sameKickoff ? "2024-01-01T12:00:00.000Z" : new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
    probabilities: { home: 0.6, away: 0.4 },
    actualOutcome: index % 10 < 6 ? "home" : "away"
  }));
}

function edge(): ValueEdge {
  return {
    marketId: "match_winner",
    selectionId: "home",
    label: "Home",
    modelProbability: 0.62,
    rawImpliedProbability: 0.5,
    noVigImpliedProbability: 0.5,
    impliedProbability: 0.5,
    bookmakerMargin: 0,
    edge: 0.12,
    expectedValue: 0.302,
    expectedRoi: 0.302,
    odds: 2.1,
    confidence: "high",
    risk: "low"
  };
}

describe("chronological empirical value guard", () => {
  it("learns one-sided Wilson floors without touching the later holdout", () => {
    const policy = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });

    expect(policy).toMatchObject({
      version: "empirical-value-guard-v1",
      source: "chronological-final-posterior-training-window",
      status: "active",
      confidenceLevel: 0.95,
      sampleSize: 200,
      reason: "eligible-probability-buckets"
    });
    expect(policy.buckets.filter((bucket) => bucket.eligible)).toHaveLength(2);
    expect(policy.buckets.find((bucket) => bucket.minProbability === 0.6)?.probabilityFloor).toBeLessThan(0.6);
    expect(Date.parse(policy.windowEnd!)).toBeLessThan(Date.parse(policy.holdoutWindowStart!));
  });

  it("passes only when both edge and EV survive the empirical probability floor", () => {
    const policy = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });
    const passed = evaluateEmpiricalValueGuard({ modelProbability: 0.62, impliedProbability: 0.5, odds: 2.1, policy });
    const blocked = evaluateEmpiricalValueGuard({ modelProbability: 0.62, impliedProbability: 0.55, odds: 1.8, policy });

    expect(passed).toMatchObject({ status: "passed", bucketSampleSize: 100, confidenceLevel: 0.95 });
    expect(passed.conservativeEdge).toBeGreaterThan(0);
    expect(passed.conservativeExpectedValue).toBeGreaterThan(0);
    expect(blocked).toMatchObject({ status: "blocked", bucketSampleSize: 100 });
    expect(blocked.conservativeEdge).toBeLessThan(0);
  });

  it("abstains for thin buckets or invalid chronology", () => {
    const thin = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(20),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });
    const invalid = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(100, true),
      holdoutWindowStart: "2024-01-01T12:00:00.000Z"
    });

    expect(thin).toMatchObject({ status: "abstain", reason: "insufficient-bucket-sample" });
    expect(invalid).toMatchObject({ status: "abstain", reason: "invalid-chronology" });
    expect(evaluateEmpiricalValueGuard({ modelProbability: 0.62, impliedProbability: 0.5, odds: 2.1, policy: thin }).status).toBe("blocked");
  });

  it("blocks a live point-estimate pick when its conservative value disappears", () => {
    const policy = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });
    const learningProfile = {
      active: true,
      allowedConfidenceBands: ["high"],
      empiricalValueGuardPolicy: policy
    } as unknown as DecisionLearningProfile;
    const fragile = { ...edge(), impliedProbability: 0.55, noVigImpliedProbability: 0.55, edge: 0.07, odds: 1.8, expectedValue: 0.116, expectedRoi: 0.116 };

    expect(selectBestPick([edge()], { learningProfile })).toMatchObject({ hasValue: true, empiricalValueGuard: { status: "passed" } });
    expect(selectBestPick([fragile], { learningProfile })).toEqual({ hasValue: false, label: "No clear value found" });
  });
});
