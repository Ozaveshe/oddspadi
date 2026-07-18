import { createHash } from "node:crypto";
import type { DecisionLearningProfile, Sport } from "@/lib/sports/types";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import { buildDecisionLearningProfileFromSnapshot } from "./decisionLearningProfile";
import { DECISION_ENGINE_VERSION } from "./decisionEngine";
import { isDecisionModelSport, runtimeModelKey, type DecisionModelSport } from "./modelIdentity";
import type { PredictionModelOverride } from "../service";

export type ShadowModelArtifact = {
  version: "shadow-model-artifact-v1";
  sport: DecisionModelSport;
  modelKey: string;
  baseModelKey: string;
  engineVersion: string;
  artifactHash: string;
  sourceBacktestId: string;
  sourceBacktestCreatedAt: string;
  frozenWindowEnd: string;
  baselineMarketPriorWeightScale: number;
  candidateMarketPriorWeightScale: number;
  validation: {
    sampleSize: number;
    baselineBrierScore: number | null;
    baselineLogLoss: number | null;
    candidateBrierScore: number | null;
    candidateLogLoss: number | null;
    historicalVerdict: "validated-proper-score-improvement" | "prospective-live-shadow";
  };
  modelOverride: PredictionModelOverride;
  controls: {
    preKickoffOnly: true;
    exactChampionSelectionOnly: true;
    publicExposure: false;
    automaticPromotion: false;
  };
};

export type ShadowModelArtifactResult =
  | { status: "ready"; artifact: ShadowModelArtifact }
  | { status: "not-applicable" | "not-configured" | "failed"; reason: string };

function canonicalJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJsonValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJsonValue(nested)])
  );
}

function stableHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalJsonValue(value))).digest("hex");
}

function frozenProfile(profile: DecisionLearningProfile, modelKey: string): DecisionLearningProfile {
  return {
    ...profile,
    status: "active",
    active: true,
    modelKey,
    engineVersion: DECISION_ENGINE_VERSION,
    calibrationPromotion: null,
    calibrationDriftStatus: null,
    calibrationDriftReceipt: null,
    reason: "Frozen private challenger profile; it can create shadow probabilities only and has no live authority.",
    notes: [
      ...profile.notes,
      "This profile is activated only inside the private shadow runner. It cannot affect public decisions or champion inference."
    ]
  };
}

export function buildShadowModelArtifact(snapshot: TrainingDataSnapshot): ShadowModelArtifactResult {
  if (!isDecisionModelSport(snapshot.sport)) {
    return { status: "not-applicable", reason: `${snapshot.sport} has no governed runtime model.` };
  }
  if (snapshot.status === "not-configured") return { status: "not-configured", reason: snapshot.reason ?? "Training storage is not configured." };
  if (snapshot.status === "failed") return { status: "failed", reason: snapshot.reason ?? "Training snapshot failed." };
  const backtest = snapshot.latestBacktest;
  if (!backtest || backtest.status !== "completed") {
    return { status: "not-applicable", reason: "No completed runtime-parity backtest is available for a frozen challenger artifact." };
  }

  const profile = buildDecisionLearningProfileFromSnapshot(snapshot, {
    activePromotion: null,
    requireDurablePromotion: true
  });
  if (profile.modelCompatibility !== "exact-runtime-parity" || profile.status !== "shadow-only") {
    return {
      status: "not-applicable",
      reason: `Latest backtest is ${profile.modelCompatibility}/${profile.status}; exact runtime-parity shadow evidence is required.`
    };
  }
  const policy = profile.marketPriorScalingPolicy;
  if (!policy || !Number.isFinite(policy.candidateWeightScale) || policy.candidateWeightScale < 0 || policy.candidateWeightScale > 3) {
    return { status: "not-applicable", reason: "No chronology-valid market-prior challenger weight is available." };
  }
  const governedBaselineWeightScale = 1;
  if (Math.abs(policy.candidateWeightScale - governedBaselineWeightScale) < 0.000001) {
    return { status: "not-applicable", reason: "The fitted market-prior challenger is identical to the unpromoted runtime baseline." };
  }
  if (!policy.validationWindowEnd || !Number.isFinite(Date.parse(policy.validationWindowEnd))) {
    return { status: "not-applicable", reason: "The challenger policy lacks a frozen validation boundary." };
  }

  const sport = snapshot.sport as DecisionModelSport;
  const baseModelKey = runtimeModelKey(sport);
  const artifactConfig = {
    version: "shadow-model-artifact-v1",
    sport,
    baseModelKey,
    engineVersion: DECISION_ENGINE_VERSION,
    sourceBacktestId: backtest.id,
    sourceBacktestCreatedAt: backtest.createdAt,
    frozenWindowEnd: policy.validationWindowEnd,
    probabilityTemperaturePolicy: profile.probabilityTemperaturePolicy,
    marketPriorScalingPolicy: policy,
    baselineMarketPriorWeightScale: governedBaselineWeightScale,
    candidateMarketPriorWeightScale: policy.candidateWeightScale,
    minimumEdge: profile.minimumEdge,
    valueEdgeWeight: profile.valueEdgeWeight,
    dataQualityWeight: profile.dataQualityWeight,
    marketAdjustmentWeight: profile.marketAdjustmentWeight,
    empiricalValueGuardPolicy: profile.empiricalValueGuardPolicy,
    segmentValueGuardPolicy: profile.segmentValueGuardPolicy
  };
  const artifactHash = stableHash(artifactConfig);
  const modelKey = `${baseModelKey}-shadow-mp-${artifactHash.slice(0, 12)}`;
  const historicalVerdict = policy.status === "active" && policy.reason === "validated-proper-score-improvement"
    ? "validated-proper-score-improvement" as const
    : "prospective-live-shadow" as const;

  return {
    status: "ready",
    artifact: {
      version: "shadow-model-artifact-v1",
      sport,
      modelKey,
      baseModelKey,
      engineVersion: DECISION_ENGINE_VERSION,
      artifactHash,
      sourceBacktestId: backtest.id,
      sourceBacktestCreatedAt: backtest.createdAt,
      frozenWindowEnd: policy.validationWindowEnd,
      baselineMarketPriorWeightScale: governedBaselineWeightScale,
      candidateMarketPriorWeightScale: policy.candidateWeightScale,
      validation: {
        sampleSize: policy.validationSampleSize,
        baselineBrierScore: policy.baselineValidation.brierScore,
        baselineLogLoss: policy.baselineValidation.logLoss,
        candidateBrierScore: policy.candidateValidation.brierScore,
        candidateLogLoss: policy.candidateValidation.logLoss,
        historicalVerdict
      },
      modelOverride: {
        modelKey,
        learningProfile: frozenProfile(profile, modelKey),
        marketPriorWeightScale: policy.candidateWeightScale
      },
      controls: {
        preKickoffOnly: true,
        exactChampionSelectionOnly: true,
        publicExposure: false,
        automaticPromotion: false
      }
    }
  };
}

export async function getShadowModelArtifact(sport: Sport): Promise<ShadowModelArtifactResult> {
  if (!isDecisionModelSport(sport)) return { status: "not-applicable", reason: `${sport} has no governed shadow model.` };
  try {
    return buildShadowModelArtifact(await getTrainingDataSnapshot(sport));
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : "Shadow model artifact resolution failed." };
  }
}
