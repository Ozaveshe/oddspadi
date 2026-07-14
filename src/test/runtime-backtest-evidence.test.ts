import { describe, expect, it } from "vitest";

import { runtimeModelIdentityReceipt, runtimeModelKey } from "@/lib/sports/prediction/modelIdentity";
import {
  inspectRuntimeBacktestEvidence,
  MINIMUM_FOOTBALL_PLAYER_FORM_COVERAGE
} from "@/lib/sports/training/runtimeBacktestEvidence";
import type { StoredBacktestRun } from "@/lib/sports/training/trainingRepository";

function run(overrides: Partial<StoredBacktestRun> = {}): StoredBacktestRun {
  return {
    id: "backtest-1",
    sport: "football",
    modelKey: runtimeModelKey("football"),
    engineVersion: "decision-engine-v1",
    status: "completed",
    dataSource: "supabase:op_fixtures:real-only:runtime-entrypoint",
    sampleSize: 1200,
    trainSize: 840,
    testSize: 360,
    pickCount: 100,
    brierScore: 0.19,
    logLoss: 0.55,
    roiUnits: 3,
    yield: 0.03,
    averageEdge: 0.05,
    closingLineValue: 0.01,
    calibrationError: 0.04,
    calibrationBuckets: [],
    learnedWeights: {},
    config: {
      modelIdentity: runtimeModelIdentityReceipt("football", {
        featureContractStatus: "passed",
        evaluatedFixtures: 360,
        entrypointInvocations: 360,
        executionHash: "fnv1a-runtime-proof"
      }),
      featureContract: {
        eligibleFixtures: 1200,
        optionalCoverage: { playerFormFixtures: 720 }
      }
    },
    notes: [],
    createdAt: "2026-07-14T12:00:00.000Z",
    ...overrides
  };
}

describe("runtime backtest evidence", () => {
  it("keeps a completed benchmark distinct from runtime-parity evidence", () => {
    const evidence = inspectRuntimeBacktestEvidence("football", run({
      modelKey: "football-poisson-elo-v1",
      config: {}
    }));

    expect(evidence.completed).toBe(true);
    expect(evidence.compatibility).toBe("benchmark-only");
    expect(evidence.exactRuntimeParity).toBe(false);
  });

  it("requires governed player-form coverage for exact-runtime football evidence", () => {
    const ready = inspectRuntimeBacktestEvidence("football", run());
    const sparse = inspectRuntimeBacktestEvidence("football", run({
      config: {
        ...run().config,
        featureContract: {
          eligibleFixtures: 1200,
          optionalCoverage: { playerFormFixtures: 719 }
        }
      }
    }));

    expect(MINIMUM_FOOTBALL_PLAYER_FORM_COVERAGE).toBe(0.6);
    expect(ready.exactRuntimeParity).toBe(true);
    expect(ready.playerFormCoverage).toBe(0.6);
    expect(ready.playerEvidenceReady).toBe(true);
    expect(sparse.playerFormCoverage).toBeCloseTo(719 / 1200);
    expect(sparse.playerEvidenceReady).toBe(false);
  });

  it("uses the weaker of training and holdout player coverage for new runtime receipts", () => {
    const evidence = inspectRuntimeBacktestEvidence("football", run({
      config: {
        ...run().config,
        featureContract: {
          eligibleFixtures: 1200,
          optionalCoverage: {
            playerFormFixtures: 900,
            playerFormEligibleFixtures: 1000,
            playerFormReadyFixtures: 700,
            playerFormTrainingEligibleFixtures: 700,
            playerFormTrainingReadyFixtures: 560,
            playerFormHoldoutEligibleFixtures: 300,
            playerFormHoldoutReadyFixtures: 140
          }
        }
      }
    }));

    expect(evidence.playerFormTrainingCoverage).toBe(0.8);
    expect(evidence.playerFormHoldoutCoverage).toBeCloseTo(140 / 300);
    expect(evidence.playerFormCoverage).toBeCloseTo(140 / 300);
    expect(evidence.playerEvidenceReady).toBe(false);
  });

  it("does not fall back to aggregate coverage when a receipt has no player-capable holdout", () => {
    const evidence = inspectRuntimeBacktestEvidence("football", run({
      config: {
        ...run().config,
        featureContract: {
          eligibleFixtures: 1200,
          optionalCoverage: {
            playerFormFixtures: 700,
            playerFormEligibleFixtures: 700,
            playerFormReadyFixtures: 700,
            playerFormTrainingEligibleFixtures: 700,
            playerFormTrainingReadyFixtures: 700,
            playerFormHoldoutEligibleFixtures: 0,
            playerFormHoldoutReadyFixtures: 0
          }
        }
      }
    }));

    expect(evidence.playerFormTrainingCoverage).toBe(1);
    expect(evidence.playerFormHoldoutCoverage).toBeNull();
    expect(evidence.playerFormCoverage).toBeNull();
    expect(evidence.playerEvidenceReady).toBe(false);
  });
});
