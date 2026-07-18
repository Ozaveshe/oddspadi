import type { Sport } from "@/lib/sports/types";
import { RUNTIME_PROBABILITY_PIPELINE_VERSION } from "./runtimeProbabilityPipeline";

export type DecisionModelSport = Extract<Sport, "football" | "basketball" | "tennis">;
export type HistoricalModelCompatibility = "exact-runtime-parity" | "benchmark-only" | "unverified-runtime-key" | "incompatible";

export type DecisionModelIdentity = Readonly<{
  sport: DecisionModelSport;
  runtimeModelKey: string;
  benchmarkBacktestModelKey: string;
  featureContractVersion: string;
  runtimeEntrypoint: string;
  probabilityPipelineVersion: typeof RUNTIME_PROBABILITY_PIPELINE_VERSION;
}>;

export type RuntimeModelIdentityProof = Readonly<{
  featureContractStatus: "passed";
  evaluatedFixtures: number;
  entrypointInvocations: number;
  executionHash: string;
}>;

const IDENTITIES: Readonly<Record<DecisionModelSport, DecisionModelIdentity>> = {
  football: {
    sport: "football",
    runtimeModelKey: "football-poisson-v5",
    benchmarkBacktestModelKey: "football-poisson-elo-v1",
    featureContractVersion: "football-runtime-features-v5",
    runtimeEntrypoint: "modelFootballMatch+decisionProbabilityPipeline",
    probabilityPipelineVersion: RUNTIME_PROBABILITY_PIPELINE_VERSION
  },
  basketball: {
    sport: "basketball",
    runtimeModelKey: "basketball-efficiency-v5",
    benchmarkBacktestModelKey: "basketball-efficiency-moneyline-v1",
    featureContractVersion: "basketball-runtime-features-v5",
    runtimeEntrypoint: "modelBasketballMatch+decisionProbabilityPipeline",
    probabilityPipelineVersion: RUNTIME_PROBABILITY_PIPELINE_VERSION
  },
  tennis: {
    sport: "tennis",
    runtimeModelKey: "tennis-surface-elo-v5",
    benchmarkBacktestModelKey: "tennis-surface-elo-match-winner-v1",
    featureContractVersion: "tennis-runtime-features-v5",
    runtimeEntrypoint: "modelTennisMatch+decisionProbabilityPipeline",
    probabilityPipelineVersion: RUNTIME_PROBABILITY_PIPELINE_VERSION
  }
};

export function isDecisionModelSport(sport: Sport | string): sport is DecisionModelSport {
  return sport === "football" || sport === "basketball" || sport === "tennis";
}

export function decisionModelIdentity(sport: DecisionModelSport): DecisionModelIdentity {
  return IDENTITIES[sport];
}

export function runtimeModelKey(sport: DecisionModelSport): string {
  return decisionModelIdentity(sport).runtimeModelKey;
}

export function benchmarkBacktestModelKey(sport: DecisionModelSport): string {
  return decisionModelIdentity(sport).benchmarkBacktestModelKey;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/**
 * A matching string is not sufficient proof. Exact parity requires a stored receipt
 * naming the runtime entrypoint and feature contract that produced the predictions.
 */
export function historicalModelCompatibility({
  sport,
  evidenceModelKey,
  config
}: {
  sport: DecisionModelSport;
  evidenceModelKey: string | null | undefined;
  config?: Record<string, unknown> | null;
}): HistoricalModelCompatibility {
  const identity = decisionModelIdentity(sport);
  if (evidenceModelKey === identity.benchmarkBacktestModelKey) return "benchmark-only";
  if (evidenceModelKey !== identity.runtimeModelKey) return "incompatible";

  const receipt = record(config?.modelIdentity);
  const exact =
    receipt.runtimeModelKey === identity.runtimeModelKey &&
    receipt.featureContractVersion === identity.featureContractVersion &&
    receipt.runtimeEntrypoint === identity.runtimeEntrypoint &&
    receipt.probabilityPipelineVersion === identity.probabilityPipelineVersion &&
    receipt.execution === "runtime-model" &&
    receipt.featureContractStatus === "passed" &&
    typeof receipt.evaluatedFixtures === "number" &&
    receipt.evaluatedFixtures > 0 &&
    receipt.entrypointInvocations === receipt.evaluatedFixtures &&
    typeof receipt.executionHash === "string" &&
    receipt.executionHash.length >= 8;
  return exact ? "exact-runtime-parity" : "unverified-runtime-key";
}

export function runtimeModelIdentityReceipt(
  sport: DecisionModelSport,
  proof: RuntimeModelIdentityProof
): Record<string, string | number> {
  const identity = decisionModelIdentity(sport);
  return {
    sport,
    runtimeModelKey: identity.runtimeModelKey,
    featureContractVersion: identity.featureContractVersion,
    runtimeEntrypoint: identity.runtimeEntrypoint,
    probabilityPipelineVersion: identity.probabilityPipelineVersion,
    execution: "runtime-model",
    featureContractStatus: proof.featureContractStatus,
    evaluatedFixtures: proof.evaluatedFixtures,
    entrypointInvocations: proof.entrypointInvocations,
    executionHash: proof.executionHash
  };
}

export function benchmarkModelIdentityReceipt(sport: DecisionModelSport): Record<string, string> {
  const identity = decisionModelIdentity(sport);
  return {
    sport,
    evidenceModelKey: identity.benchmarkBacktestModelKey,
    targetRuntimeModelKey: identity.runtimeModelKey,
    targetFeatureContractVersion: identity.featureContractVersion,
    targetProbabilityPipelineVersion: identity.probabilityPipelineVersion,
    execution: "benchmark-model",
    compatibility: "benchmark-only"
  };
}
