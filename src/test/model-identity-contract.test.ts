import { describe, expect, it } from "vitest";
import {
  benchmarkBacktestModelKey,
  benchmarkModelIdentityReceipt,
  decisionModelIdentity,
  historicalModelCompatibility,
  runtimeModelIdentityReceipt,
  runtimeModelKey
} from "@/lib/sports/prediction/modelIdentity";

describe("decision model identity contract", () => {
  it.each([
    ["football", "football-poisson-v5", "football-poisson-elo-v1"],
    ["basketball", "basketball-efficiency-v5", "basketball-efficiency-moneyline-v1"],
    ["tennis", "tennis-surface-elo-v5", "tennis-surface-elo-match-winner-v1"]
  ] as const)("registers distinct runtime and benchmark identities for %s", (sport, runtime, benchmark) => {
    expect(runtimeModelKey(sport)).toBe(runtime);
    expect(benchmarkBacktestModelKey(sport)).toBe(benchmark);
    expect(decisionModelIdentity(sport).runtimeModelKey).not.toBe(decisionModelIdentity(sport).benchmarkBacktestModelKey);
    expect(benchmarkModelIdentityReceipt(sport)).toMatchObject({ compatibility: "benchmark-only", targetRuntimeModelKey: runtime });
  });

  it("requires executable and feature-contract proof instead of trusting a matching key string", () => {
    expect(historicalModelCompatibility({ sport: "football", evidenceModelKey: "football-poisson-elo-v1" })).toBe("benchmark-only");
    expect(historicalModelCompatibility({ sport: "football", evidenceModelKey: "football-poisson-v5", config: {} })).toBe("unverified-runtime-key");
    expect(historicalModelCompatibility({
      sport: "football",
      evidenceModelKey: "football-poisson-v5",
      config: { modelIdentity: runtimeModelIdentityReceipt("football", {
        featureContractStatus: "passed",
        evaluatedFixtures: 120,
        entrypointInvocations: 120,
        executionHash: "fnv1a-contract"
      }) }
    })).toBe("exact-runtime-parity");
    expect(historicalModelCompatibility({
      sport: "football",
      evidenceModelKey: "football-poisson-v5",
      config: {
        modelIdentity: {
          ...runtimeModelIdentityReceipt("football", {
            featureContractStatus: "passed",
            evaluatedFixtures: 120,
            entrypointInvocations: 120,
            executionHash: "fnv1a-contract"
          }),
          entrypointInvocations: 119
        }
      }
    })).toBe("unverified-runtime-key");
    expect(historicalModelCompatibility({ sport: "football", evidenceModelKey: "football-poisson-v99" })).toBe("incompatible");
  });

  it("invalidates pre-pipeline runtime receipts", () => {
    expect(historicalModelCompatibility({
      sport: "football",
      evidenceModelKey: "football-poisson-v5",
      config: {
        modelIdentity: {
          ...runtimeModelIdentityReceipt("football", {
            featureContractStatus: "passed",
            evaluatedFixtures: 120,
            entrypointInvocations: 120,
            executionHash: "fnv1a-contract"
          }),
          featureContractVersion: "football-runtime-features-v3",
          runtimeEntrypoint: "modelFootballMatch",
          probabilityPipelineVersion: undefined
        }
      }
    })).toBe("unverified-runtime-key");
  });

  it("invalidates v4 model receipts after bookmaker-consensus pipeline promotion", () => {
    expect(historicalModelCompatibility({
      sport: "football",
      evidenceModelKey: "football-poisson-v4",
      config: {
        modelIdentity: {
          runtimeModelKey: "football-poisson-v4",
          featureContractVersion: "football-runtime-features-v4",
          runtimeEntrypoint: "modelFootballMatch+decisionProbabilityPipeline",
          probabilityPipelineVersion: "decision-probability-pipeline-v1",
          execution: "runtime-model",
          featureContractStatus: "passed",
          evaluatedFixtures: 120,
          entrypointInvocations: 120,
          executionHash: "fnv1a-old-receipt"
        }
      }
    })).toBe("incompatible");
  });
});
