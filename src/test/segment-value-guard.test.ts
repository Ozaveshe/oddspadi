import { describe, expect, it } from "vitest";
import { selectBestPick } from "@/lib/sports/prediction/odds";
import { predictionSegmentKey } from "@/lib/sports/prediction/predictionSegment";
import {
  evaluateSegmentValueGuard,
  learnSegmentValueGuardPolicy,
  type SegmentProbabilityObservation
} from "@/lib/sports/prediction/segmentValueGuard";
import type { DecisionLearningProfile, Match, ValueEdge } from "@/lib/sports/types";

function datedRows({
  segmentKey,
  startDay,
  wins,
  count = 40
}: {
  segmentKey: string | null;
  startDay: number;
  wins: number;
  count?: number;
}): SegmentProbabilityObservation[] {
  return Array.from({ length: count }, (_, index) => ({
    kickoffAt: new Date(Date.UTC(2025, 0, startDay + index, 12)).toISOString(),
    probabilities: { home: 0.62, away: 0.38 },
    actualOutcome: index < wins ? "home" : "away",
    segmentKey
  }));
}

function interleavedRegimes(): SegmentProbabilityObservation[] {
  const earlierStable = datedRows({ segmentKey: "competition:stable", startDay: 1, wins: 32 });
  const earlierReversed = datedRows({ segmentKey: "competition:reversed", startDay: 1, wins: 32 });
  const recentStable = datedRows({ segmentKey: "competition:stable", startDay: 101, wins: 32 });
  const recentReversed = datedRows({ segmentKey: "competition:reversed", startDay: 101, wins: 8 });
  return [...earlierStable, ...earlierReversed, ...recentStable, ...recentReversed]
    .sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt));
}

function edge(): ValueEdge {
  return {
    marketId: "match_winner",
    selectionId: "home",
    label: "Home",
    modelProbability: 0.62,
    rawImpliedProbability: 0.2,
    noVigImpliedProbability: 0.2,
    impliedProbability: 0.2,
    bookmakerMargin: 0.04,
    edge: 0.42,
    expectedValue: 1.48,
    expectedRoi: 1.48,
    odds: 4,
    confidence: "high",
    risk: "medium"
  };
}

describe("segment value guard", () => {
  it("uses provider competition identity for team sports and a mutually confirmed tennis surface", () => {
    const base = {
      league: { id: "API-Football:39" },
      homeTeam: { ratingEvidence: {} },
      awayTeam: { ratingEvidence: {} }
    } as Match;
    expect(predictionSegmentKey({ ...base, sport: "football" })).toBe("competition:api-football-39");
    expect(predictionSegmentKey({
      ...base,
      sport: "tennis",
      homeTeam: { ratingEvidence: { surface: "Clay" } },
      awayTeam: { ratingEvidence: { surface: "clay" } }
    } as Match)).toBe("surface:clay");
    expect(predictionSegmentKey({
      ...base,
      sport: "tennis",
      homeTeam: { ratingEvidence: { surface: "clay" } },
      awayTeam: { ratingEvidence: { surface: "hard" } }
    } as Match)).toBeNull();
  });

  it("blocks a recent competition reversal hidden by pooled history while admitting the stable competition", () => {
    const policy = learnSegmentValueGuardPolicy({
      trainingRows: interleavedRegimes(),
      holdoutWindowStart: "2026-01-01T12:00:00.000Z",
      segmentDimension: "competition"
    });

    expect(policy).toMatchObject({ status: "active", sampleSize: 320, unresolvedSampleSize: 0 });
    const stable = evaluateSegmentValueGuard({
      segmentKey: "competition:stable",
      modelProbability: 0.62,
      impliedProbability: 0.2,
      odds: 4,
      policy
    });
    const reversed = evaluateSegmentValueGuard({
      segmentKey: "competition:reversed",
      modelProbability: 0.62,
      impliedProbability: 0.2,
      odds: 4,
      policy
    });

    expect(stable).toMatchObject({ status: "passed", segmentKey: "competition:stable", bucketSampleSize: 80 });
    expect(reversed).toMatchObject({ status: "blocked", segmentKey: "competition:reversed", bucketSampleSize: 80 });
    expect(reversed.recentProbabilityFloor).toBeLessThan(reversed.earlierProbabilityFloor!);
  });

  it("fails closed for unknown and thin exact segments", () => {
    const policy = learnSegmentValueGuardPolicy({
      trainingRows: interleavedRegimes(),
      holdoutWindowStart: "2026-01-01T12:00:00.000Z",
      segmentDimension: "competition"
    });
    const unknown = evaluateSegmentValueGuard({ segmentKey: null, modelProbability: 0.62, impliedProbability: 0.2, odds: 4, policy });
    const unseen = evaluateSegmentValueGuard({ segmentKey: "competition:new", modelProbability: 0.62, impliedProbability: 0.2, odds: 4, policy });
    expect(unknown).toMatchObject({ status: "blocked", segmentKey: null });
    expect(unseen).toMatchObject({ status: "blocked", segmentKey: "competition:new" });
  });

  it("does not split identical kickoff cohorts across regimes", () => {
    const policy = learnSegmentValueGuardPolicy({
      trainingRows: Array.from({ length: 80 }, (_, index) => ({
        kickoffAt: "2025-01-01T12:00:00.000Z",
        probabilities: { home: 0.62, away: 0.38 },
        actualOutcome: index < 56 ? "home" : "away",
        segmentKey: "surface:hard"
      })),
      holdoutWindowStart: "2025-02-01T12:00:00.000Z",
      segmentDimension: "surface"
    });
    expect(policy).toMatchObject({ status: "abstain", reason: "invalid-chronology" });
  });

  it("recomputes the governed segment decision during final pick selection", () => {
    const policy = learnSegmentValueGuardPolicy({
      trainingRows: interleavedRegimes(),
      holdoutWindowStart: "2026-01-01T12:00:00.000Z",
      segmentDimension: "competition"
    });
    const learningProfile = {
      active: true,
      segmentValueGuardPolicy: policy,
      empiricalValueGuardPolicy: null,
      allowedConfidenceBands: ["high"]
    } as unknown as DecisionLearningProfile;

    expect(selectBestPick([edge()], { learningProfile, segmentKey: "competition:stable" })).toMatchObject({
      hasValue: true,
      segmentValueGuard: { status: "passed", segmentKey: "competition:stable" }
    });
    expect(selectBestPick([{ ...edge(), segmentValueGuard: { status: "passed" } } as ValueEdge], {
      learningProfile,
      segmentKey: "competition:reversed"
    })).toEqual({ hasValue: false, label: "No clear value found" });
  });
});
