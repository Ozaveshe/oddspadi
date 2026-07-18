import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DecisionLearningProfile } from "@/lib/sports/types";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { DECISION_ENGINE_VERSION } from "@/lib/sports/prediction/decisionEngine";
import { runtimeModelKey } from "@/lib/sports/prediction/modelIdentity";

const buildDecisionLearningProfileFromSnapshot = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sports/prediction/decisionLearningProfile", () => ({ buildDecisionLearningProfileFromSnapshot }));

import { buildShadowModelArtifact } from "@/lib/sports/prediction/shadowModelArtifact";

function snapshot(): TrainingDataSnapshot {
  return {
    sport: "football",
    status: "ready",
    latestBacktest: {
      id: "backtest-frozen-1",
      status: "completed",
      createdAt: "2026-07-18T01:00:00.000Z"
    }
  } as TrainingDataSnapshot;
}

function profile(candidateWeightScale = 1.7): DecisionLearningProfile {
  return {
    sport: "football",
    status: "shadow-only",
    active: false,
    modelCompatibility: "exact-runtime-parity",
    modelKey: runtimeModelKey("football"),
    engineVersion: DECISION_ENGINE_VERSION,
    reason: "Frozen chronology-valid policy awaits prospective evidence.",
    notes: [],
    minimumEdge: 0.03,
    valueEdgeWeight: 0.4,
    dataQualityWeight: 0.2,
    marketAdjustmentWeight: 0.15,
    probabilityTemperaturePolicy: null,
    empiricalValueGuardPolicy: null,
    segmentValueGuardPolicy: null,
    calibrationPromotion: null,
    calibrationDriftStatus: null,
    calibrationDriftReceipt: null,
    marketPriorScalingPolicy: {
      version: "market-prior-scaling-v1",
      source: "chronological-priced-training-window",
      status: "active",
      weightScale: 1,
      candidateWeightScale,
      fitSampleSize: 80,
      validationSampleSize: 60,
      fitWindowStart: "2026-01-01T00:00:00.000Z",
      fitWindowEnd: "2026-03-31T00:00:00.000Z",
      validationWindowStart: "2026-04-01T00:00:00.000Z",
      validationWindowEnd: "2026-06-30T00:00:00.000Z",
      holdoutWindowStart: "2026-07-01T00:00:00.000Z",
      baselineFit: { sampleSize: 80, brierScore: 0.22, logLoss: 0.64 },
      candidateFit: { sampleSize: 80, brierScore: 0.2, logLoss: 0.61 },
      baselineValidation: { sampleSize: 60, brierScore: 0.23, logLoss: 0.65 },
      candidateValidation: { sampleSize: 60, brierScore: 0.21, logLoss: 0.62 },
      reason: "validated-proper-score-improvement"
    }
  } as unknown as DecisionLearningProfile;
}

describe("frozen shadow model artifact", () => {
  beforeEach(() => buildDecisionLearningProfileFromSnapshot.mockReturnValue(profile()));

  it("builds a stable private identity from chronology-valid runtime evidence", () => {
    const first = buildShadowModelArtifact(snapshot());
    const second = buildShadowModelArtifact(snapshot());

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "ready",
      artifact: {
        modelKey: expect.stringMatching(new RegExp(`^${runtimeModelKey("football")}-shadow-mp-[a-f0-9]{12}$`)),
        candidateMarketPriorWeightScale: 1.7,
        validation: { historicalVerdict: "validated-proper-score-improvement" },
        controls: { preKickoffOnly: true, exactChampionSelectionOnly: true, publicExposure: false, automaticPromotion: false },
        modelOverride: { learningProfile: { active: true, status: "active" } }
      }
    });
  });

  it("changes identity when the frozen candidate configuration changes and rejects identity challengers", () => {
    const first = buildShadowModelArtifact(snapshot());
    buildDecisionLearningProfileFromSnapshot.mockReturnValue(profile(1.9));
    const changed = buildShadowModelArtifact(snapshot());
    buildDecisionLearningProfileFromSnapshot.mockReturnValue(profile(1));
    const identity = buildShadowModelArtifact(snapshot());

    expect(first.status === "ready" && changed.status === "ready" && first.artifact.artifactHash).not.toBe(
      changed.status === "ready" ? changed.artifact.artifactHash : null
    );
    expect(identity).toMatchObject({ status: "not-applicable", reason: expect.stringContaining("identical") });
  });

  it("keeps artifact identity stable when nested policy keys arrive in a different order", () => {
    const first = buildShadowModelArtifact(snapshot());
    const reordered = profile();
    reordered.marketPriorScalingPolicy = Object.fromEntries(
      Object.entries(reordered.marketPriorScalingPolicy!).reverse()
    ) as DecisionLearningProfile["marketPriorScalingPolicy"];
    buildDecisionLearningProfileFromSnapshot.mockReturnValue(reordered);
    const second = buildShadowModelArtifact(snapshot());

    expect(first.status).toBe("ready");
    expect(second.status).toBe("ready");
    expect(first.status === "ready" && second.status === "ready" && second.artifact.artifactHash).toBe(
      first.status === "ready" ? first.artifact.artifactHash : null
    );
  });

  it("treats a validated fitted scale as a challenger to the unpromoted runtime baseline", () => {
    const validated = profile(1.7);
    validated.marketPriorScalingPolicy = {
      ...validated.marketPriorScalingPolicy!,
      weightScale: 1.7,
      candidateWeightScale: 1.7
    };
    buildDecisionLearningProfileFromSnapshot.mockReturnValue(validated);

    expect(buildShadowModelArtifact(snapshot())).toMatchObject({
      status: "ready",
      artifact: { baselineMarketPriorWeightScale: 1, candidateMarketPriorWeightScale: 1.7 }
    });
  });

  it("rejects non-runtime-parity evidence", () => {
    buildDecisionLearningProfileFromSnapshot.mockReturnValue({ ...profile(), modelCompatibility: "benchmark-only" });
    expect(buildShadowModelArtifact(snapshot())).toMatchObject({
      status: "not-applicable",
      reason: expect.stringContaining("exact runtime-parity")
    });
  });
});
