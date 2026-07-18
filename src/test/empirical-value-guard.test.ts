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
    actualOutcome: index % 10 < 7 ? "home" : "away"
  }));
}

function reversalRows() {
  return Array.from({ length: 100 }, (_, index) => ({
    kickoffAt: new Date(Date.UTC(2024, 0, index + 1)).toISOString(),
    probabilities: { home: 0.6, away: 0.4 },
    actualOutcome: index < 50
      ? index % 5 === 0 ? "away" : "home"
      : index % 5 === 0 ? "home" : "away"
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
  it("learns a joint-confidence floor from strict earlier and recent regimes", () => {
    const policy = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });

    expect(policy).toMatchObject({
      version: "empirical-value-guard-v2",
      source: "chronological-final-posterior-regime-windows",
      status: "active",
      confidenceLevel: 0.95,
      regimeConfidenceLevel: 0.975,
      minimumBucketSample: 60,
      minimumRegimeSample: 30,
      sampleSize: 200,
      reason: "stable-regime-buckets"
    });
    expect(policy.earlierWindow.sampleSize).toBe(100);
    expect(policy.recentWindow.sampleSize).toBe(100);
    expect(Date.parse(policy.earlierWindow.windowEnd!)).toBeLessThan(Date.parse(policy.recentWindow.windowStart!));
    expect(policy.buckets.filter((bucket) => bucket.eligible)).toHaveLength(2);
    const home = policy.buckets.find((bucket) => bucket.minProbability === 0.6)!;
    expect(home.probabilityFloor).toBe(Math.min(
      home.aggregateProbabilityFloor!,
      home.earlier.probabilityFloor!,
      home.recent.probabilityFloor!
    ));
    expect(Date.parse(policy.windowEnd!)).toBeLessThan(Date.parse(policy.holdoutWindowStart!));
  });

  it("blocks aggregate value when the recent regime has reversed", () => {
    const policy = learnEmpiricalValueGuardPolicy({
      trainingRows: reversalRows(),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });
    const bucket = policy.buckets.find((candidate) => candidate.minProbability === 0.6)!;
    const decision = evaluateEmpiricalValueGuard({ modelProbability: 0.62, impliedProbability: 0.35, odds: 2.9, policy });

    expect(policy.status).toBe("active");
    expect(bucket.aggregateProbabilityFloor).toBeGreaterThan(0.35);
    expect(bucket.recent.probabilityFloor).toBeLessThan(0.35);
    expect(bucket.probabilityFloor).toBe(bucket.recent.probabilityFloor);
    expect(decision).toMatchObject({ status: "blocked", regimeObservedRateDrift: -0.6 });
  });

  it("passes only when edge and EV survive both regimes", () => {
    const policy = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });
    const passed = evaluateEmpiricalValueGuard({ modelProbability: 0.62, impliedProbability: 0.5, odds: 2.1, policy });
    const blocked = evaluateEmpiricalValueGuard({ modelProbability: 0.62, impliedProbability: 0.65, odds: 1.55, policy });

    expect(passed).toMatchObject({ status: "passed", bucketSampleSize: 100, confidenceLevel: 0.95 });
    expect(passed.earlierProbabilityFloor).toBeGreaterThan(0.5);
    expect(passed.recentProbabilityFloor).toBeGreaterThan(0.5);
    expect(passed.conservativeEdge).toBeGreaterThan(0);
    expect(passed.conservativeExpectedValue).toBeGreaterThan(0);
    expect(blocked).toMatchObject({ status: "blocked", bucketSampleSize: 100 });
    expect(blocked.conservativeEdge).toBeLessThan(0);
  });

  it("abstains for thin regimes or an unsplittable kickoff cohort", () => {
    const thin = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(40),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });
    const invalid = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(100, true),
      holdoutWindowStart: "2024-02-01T12:00:00.000Z"
    });

    expect(thin).toMatchObject({ status: "abstain", reason: "insufficient-regime-sample" });
    expect(invalid).toMatchObject({ status: "abstain", reason: "invalid-chronology" });
    expect(invalid.earlierWindow.sampleSize).toBe(0);
    expect(evaluateEmpiricalValueGuard({ modelProbability: 0.62, impliedProbability: 0.5, odds: 2.1, policy: thin }).status).toBe("blocked");
  });

  it("blocks a live point-estimate pick when regime-stable value disappears", () => {
    const policy = learnEmpiricalValueGuardPolicy({
      trainingRows: rows(),
      holdoutWindowStart: "2024-05-01T00:00:00.000Z"
    });
    const learningProfile = {
      active: true,
      allowedConfidenceBands: ["high"],
      empiricalValueGuardPolicy: policy
    } as unknown as DecisionLearningProfile;
    const fragile = { ...edge(), impliedProbability: 0.65, noVigImpliedProbability: 0.65, edge: 0.07, odds: 1.55, expectedValue: 0.116, expectedRoi: 0.116 };

    expect(selectBestPick([edge()], { learningProfile })).toMatchObject({ hasValue: true, empiricalValueGuard: { status: "passed" } });
    expect(selectBestPick([fragile], { learningProfile })).toEqual({ hasValue: false, label: "No clear value found" });
  });
});
