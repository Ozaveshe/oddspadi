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
});
