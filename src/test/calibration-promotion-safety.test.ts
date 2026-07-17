import { describe, expect, it } from "vitest";
import { buildDecisionCalibrationCohorts, type DecisionRunRow, type OutcomeRow } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionLearningProfileFromSnapshot } from "@/lib/sports/prediction/decisionLearningProfile";
import type { ActiveCalibrationPromotion } from "@/lib/sports/prediction/decisionCalibrationPromotion";
import { applyLearnedProbabilityCalibration } from "@/lib/sports/prediction/learnedProbabilityCalibration";
import { classifyPredictionOutcomeTransition, isPredictionOutcomeIdempotencyConflict } from "@/lib/sports/prediction/decisionOutcomes";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";
import type { DecisionLearningProfile, PredictionMarket } from "@/lib/sports/types";
import { runtimeModelIdentityReceipt, runtimeModelKey } from "@/lib/sports/prediction/modelIdentity";

const FOOTBALL_RUNTIME_MODEL_KEY = runtimeModelKey("football");

function outcome(id: string, decisionRunId: string): OutcomeRow {
  return {
    id,
    decision_run_id: decisionRunId,
    fixture_external_id: `fixture-${id}`,
    sport: "football",
    model_probability: 0.62,
    implied_probability: 0.55,
    value_edge: 0.07,
    odds: 2.1,
    closing_odds: 2.05,
    result: id.endsWith("lost") ? "lost" : "won",
    settled_at: "2026-08-21T20:00:00.000Z",
    created_at: "2026-08-21T12:00:00.000Z"
  };
}

function run(id: string, modelKey: string, engineVersion: string): DecisionRunRow {
  return { id, confidence: "medium", health: "stable", model_key: modelKey, engine_version: engineVersion };
}

function activeProfile(): DecisionLearningProfile {
  return {
    status: "active",
    source: "settled-outcomes",
    active: true,
    modelKey: "football-poisson-v2",
    engineVersion: "decision-engine-v1",
    sampleSize: 1200,
    realFinishedFixtures: 1200,
    minimumRecommendedFixtures: 30,
    minimumEdge: null,
    valueEdgeWeight: null,
    dataQualityWeight: null,
    marketAdjustmentWeight: null,
    homeAdvantageElo: null,
    brierScore: 0.19,
    yield: 0.03,
    closingLineValue: 0.01,
    calibrationBuckets: [
      { minProbability: 0.2, maxProbability: 0.5, sampleSize: 40, averageProbability: 0.35, observedRate: 0.32, calibrationError: 0.03 },
      { minProbability: 0.5, maxProbability: 0.8, sampleSize: 60, averageProbability: 0.62, observedRate: 0.65, calibrationError: 0.03 }
    ],
    generatedAt: "2026-08-21T12:00:00.000Z",
    reason: "Approved model-bound calibration.",
    notes: []
  };
}

function readySnapshot(): TrainingDataSnapshot {
  return {
    generatedAt: "2026-08-21T12:00:00.000Z",
    status: "ready",
    configured: true,
    sport: "football",
    counts: { realFinishedFixtures: 1200 },
    latestBacktest: {
      id: "backtest-1",
      sport: "football",
      modelKey: FOOTBALL_RUNTIME_MODEL_KEY,
      engineVersion: "decision-engine-v1",
      status: "completed",
      dataSource: "supabase:op_fixtures:real-only",
      sampleSize: 1200,
      trainSize: 840,
      testSize: 360,
      pickCount: 120,
      brierScore: 0.19,
      logLoss: 0.55,
      roiUnits: 4.8,
      yield: 0.04,
      averageEdge: 0.06,
      closingLineValue: 0.02,
      calibrationError: 0.04,
      calibrationBuckets: [
        { minProbability: 0.2, maxProbability: 0.5, sampleSize: 500, averageProbability: 0.35, observedRate: 0.34, calibrationError: 0.01 },
        { minProbability: 0.5, maxProbability: 0.8, sampleSize: 700, averageProbability: 0.62, observedRate: 0.63, calibrationError: 0.01 }
      ],
      learnedWeights: { minimumEdge: 0.03, valueEdgeWeight: 0.4, dataQualityWeight: 0.2 },
      config: {
        learnedWeightsProvenance: {
          source: "training-window",
          sampleSize: 840,
          pickCount: 90,
          windowStart: "2023-01-01T12:00:00.000Z",
          windowEnd: "2025-06-30T12:00:00.000Z",
          holdoutWindowStart: "2025-07-01T12:00:00.000Z",
          yield: 0.03,
          brierScore: 0.2,
          closingLineValue: 0.01
        },
        modelIdentity: runtimeModelIdentityReceipt("football", {
          featureContractStatus: "passed",
          evaluatedFixtures: 360,
          entrypointInvocations: 360,
          executionHash: "fnv1a-calibration"
        }),
        featureContract: {
          eligibleFixtures: 1200,
          optionalCoverage: { playerFormFixtures: 900 }
        },
        selectionPolicy: {
          version: "economic-confidence-bands-v1",
          source: "chronological-training-window",
          status: "active",
          allowedConfidenceBands: ["medium"]
        },
        probabilityCalibrationPolicy: {
          version: "temperature-scaling-v1",
          source: "chronological-training-window",
          status: "active",
          temperature: 1.2,
          fitSampleSize: 588,
          validationSampleSize: 252,
          fitWindowStart: "2023-01-01T12:00:00.000Z",
          fitWindowEnd: "2024-12-31T12:00:00.000Z",
          validationWindowStart: "2025-01-01T12:00:00.000Z",
          validationWindowEnd: "2025-06-30T12:00:00.000Z",
          holdoutWindowStart: "2025-07-01T12:00:00.000Z",
          baselineValidation: { sampleSize: 252, brierScore: 0.21, logLoss: 0.62 },
          calibratedValidation: { sampleSize: 252, brierScore: 0.205, logLoss: 0.615 },
          reason: "validated-proper-score-improvement"
        }
      },
      notes: [],
      createdAt: "2026-08-21T12:00:00.000Z"
    },
    readiness: { readyForTraining: true, minimumRecommendedFixtures: 1000, detail: "ready" }
  } as unknown as TrainingDataSnapshot;
}

function promotion(modelKey = FOOTBALL_RUNTIME_MODEL_KEY, engineVersion = "decision-engine-v1"): ActiveCalibrationPromotion {
  return {
    id: "promotion-1",
    candidateId: "candidate-1",
    sport: "football",
    modelKey,
    engineVersion,
    approvedAt: "2026-08-21T12:00:00.000Z",
    expiresAt: null,
    approvedBy: "risk-operator",
    rationale: "Prospective shadow results passed review.",
    candidate: {
      id: "candidate-1",
      source: "settled-outcomes",
      sampleSize: 40,
      settledSize: 40,
      outcomeHash: "fnv1a-test",
      probabilityBuckets: [
        {
          id: "p20",
          lowerBound: 0.2,
          upperBound: 0.5,
          sampleSize: 20,
          settledSize: 20,
          winRate: 0.35,
          brierScore: 0.2,
          logLoss: 0.6,
          averageProbability: 0.34,
          calibrationGap: 0.01,
          winRateInterval: null,
          roiUnits: 1
        }
      ],
      metrics: { promotionReadiness: { status: "ready-shadow-review" } }
    }
  };
}

describe("calibration promotion safety", () => {
  it("isolates settled outcomes by model key and engine version before calibration", () => {
    const cohorts = buildDecisionCalibrationCohorts({
      sport: "football",
      decisionRuns: [run("run-a", "football-poisson-v2", "decision-engine-v1"), run("run-b", "football-poisson-v3", "decision-engine-v2")],
      outcomes: [outcome("a-won", "run-a"), outcome("a-lost", "run-a"), outcome("b-won", "run-b")]
    });

    expect(cohorts).toHaveLength(2);
    expect(cohorts[0]?.modelKey).toBe("football-poisson-v3");
    expect(cohorts.map((cohort) => `${cohort.modelKey}:${cohort.engineVersion}`)).toEqual(
      expect.arrayContaining(["football-poisson-v2:decision-engine-v1", "football-poisson-v3:decision-engine-v2"])
    );
    expect(cohorts.find((cohort) => cohort.modelKey === "football-poisson-v2")?.outcomes.map((row) => row.id)).toEqual(["a-won", "a-lost"]);
    expect(cohorts.find((cohort) => cohort.modelKey === "football-poisson-v3")?.outcomes.map((row) => row.id)).toEqual(["b-won"]);
  });

  it("refuses a promoted curve scoped to a different model or engine", () => {
    const markets: PredictionMarket[] = [{ marketId: "match_winner", probabilities: { home: 0.61, draw: 0.22, away: 0.17 } }];
    const wrongModel = applyLearnedProbabilityCalibration({ markets, profile: activeProfile(), modelKey: "football-poisson-v3", engineVersion: "decision-engine-v1" });
    const wrongEngine = applyLearnedProbabilityCalibration({ markets, profile: activeProfile(), modelKey: "football-poisson-v2", engineVersion: "decision-engine-v2" });

    expect(wrongModel.adjustment.status).toBe("inactive");
    expect(wrongEngine.adjustment.status).toBe("inactive");
    expect(wrongModel.markets).toEqual(markets);
    expect(wrongEngine.markets).toEqual(markets);
  });

  it("requires a durable promotion that matches the historical model before activation", () => {
    const snapshot = readySnapshot();
    const active = buildDecisionLearningProfileFromSnapshot(snapshot, { activePromotion: promotion(), requireDurablePromotion: true });
    const mismatched = buildDecisionLearningProfileFromSnapshot(snapshot, {
      activePromotion: promotion("football-poisson-v3", "decision-engine-v2"),
      requireDurablePromotion: true
    });

    expect(active.active).toBe(true);
    expect(active.modelCompatibility).toBe("exact-runtime-parity");
    expect(active.playerFormCoverage).toBe(0.75);
    expect(active.calibrationPromotion).toMatchObject({ id: "promotion-1", candidateId: "candidate-1" });
    expect(mismatched.active).toBe(false);
    expect(mismatched.reason).toContain("model-bound calibration promotion");
  });

  it("keeps benchmark and receipt-free runtime-key backtests out of live learning", () => {
    const benchmark = readySnapshot();
    benchmark.latestBacktest = {
      ...benchmark.latestBacktest!,
      modelKey: "football-poisson-elo-v1",
      config: {}
    };
    const unverifiedRuntimeKey = readySnapshot();
    unverifiedRuntimeKey.latestBacktest = { ...unverifiedRuntimeKey.latestBacktest!, config: {} };

    const benchmarkProfile = buildDecisionLearningProfileFromSnapshot(benchmark, {
      activePromotion: promotion("football-poisson-elo-v1"),
      requireDurablePromotion: true
    });
    const unverifiedProfile = buildDecisionLearningProfileFromSnapshot(unverifiedRuntimeKey, {
      activePromotion: promotion(),
      requireDurablePromotion: true
    });

    expect(benchmarkProfile.active).toBe(false);
    expect(benchmarkProfile.reason).toContain("benchmark model");
    expect(unverifiedProfile.active).toBe(false);
    expect(unverifiedProfile.reason).toContain("without a matching execution and feature-contract receipt");
  });

  it("keeps legacy holdout-derived football weights shadow-only without training-window provenance", () => {
    const snapshot = readySnapshot();
    snapshot.latestBacktest = {
      ...snapshot.latestBacktest!,
      config: { modelIdentity: snapshot.latestBacktest!.config?.modelIdentity }
    };

    const profile = buildDecisionLearningProfileFromSnapshot(snapshot, {
      activePromotion: promotion(),
      requireDurablePromotion: true
    });

    expect(profile.active).toBe(false);
    expect(profile.reason).toContain("learned weights lack training-window-only provenance");
  });

  it("keeps an exact-runtime football profile shadow-only when player-form history is too sparse", () => {
    const snapshot = readySnapshot();
    snapshot.latestBacktest = {
      ...snapshot.latestBacktest!,
      config: {
        ...snapshot.latestBacktest!.config,
        featureContract: {
          eligibleFixtures: 1200,
          optionalCoverage: { playerFormFixtures: 240 }
        }
      }
    };

    const profile = buildDecisionLearningProfileFromSnapshot(snapshot, {
      activePromotion: promotion(),
      requireDurablePromotion: true
    });

    expect(profile.active).toBe(false);
    expect(profile.modelCompatibility).toBe("exact-runtime-parity");
    expect(profile.playerFormCoverage).toBe(0.2);
    expect(profile.reason).toContain("player-form coverage is 20.0%; 60% of chronology-safe fixtures is required");
  });

  it("keeps a promoted exact-runtime replay shadow-only when its training-only economic policy abstains", () => {
    const snapshot = readySnapshot();
    snapshot.latestBacktest = {
      ...snapshot.latestBacktest!,
      config: {
        ...snapshot.latestBacktest!.config,
        selectionPolicy: {
          version: "economic-confidence-bands-v1",
          source: "chronological-training-window",
          status: "abstain",
          allowedConfidenceBands: []
        }
      }
    };

    const profile = buildDecisionLearningProfileFromSnapshot(snapshot, {
      activePromotion: promotion(),
      requireDurablePromotion: true
    });

    expect(profile.active).toBe(false);
    expect(profile.economicSelectionPolicyStatus).toBe("abstain");
    expect(profile.allowedConfidenceBands).toEqual([]);
    expect(profile.reason).toContain("training-only economic selection policy abstains");
  });

  it("accepts a validated identity policy but blocks an invalid or thin probability policy", () => {
    const snapshot = readySnapshot();
    snapshot.latestBacktest = {
      ...snapshot.latestBacktest!,
      config: {
        ...snapshot.latestBacktest!.config,
        probabilityCalibrationPolicy: {
          ...snapshot.latestBacktest!.config?.probabilityCalibrationPolicy as Record<string, unknown>,
          status: "identity",
          temperature: 1,
          reason: "validation-did-not-improve",
          calibratedValidation: { sampleSize: 252, brierScore: 0.21, logLoss: 0.62 }
        }
      }
    };

    const profile = buildDecisionLearningProfileFromSnapshot(snapshot, {
      activePromotion: promotion(),
      requireDurablePromotion: true
    });

    expect(profile.active).toBe(true);
    expect(profile.probabilityTemperaturePolicy).toMatchObject({ status: "identity", temperature: 1 });

    snapshot.latestBacktest = {
      ...snapshot.latestBacktest!,
      config: {
        ...snapshot.latestBacktest!.config,
        probabilityCalibrationPolicy: {
          ...snapshot.latestBacktest!.config?.probabilityCalibrationPolicy as Record<string, unknown>,
          validationSampleSize: 0,
          reason: "insufficient-training-sample"
        }
      }
    };
    const blocked = buildDecisionLearningProfileFromSnapshot(snapshot, {
      activePromotion: promotion(),
      requireDurablePromotion: true
    });
    expect(blocked.active).toBe(false);
    expect(blocked.probabilityTemperaturePolicy).toBeNull();
    expect(blocked.reason).toContain("lacks a valid training-only probability calibration policy");
  });

  it("accepts learned weights sourced from the complete prospective training-validation window", () => {
    const snapshot = readySnapshot();
    snapshot.latestBacktest = {
      ...snapshot.latestBacktest!,
      config: {
        ...snapshot.latestBacktest!.config,
        learnedWeightsProvenance: {
          source: "training-validation-window",
          sampleSize: 252,
          pickCount: 40,
          windowStart: "2025-01-01T12:00:00.000Z",
          windowEnd: "2025-06-30T12:00:00.000Z",
          holdoutWindowStart: "2025-07-01T12:00:00.000Z",
          yield: 0.03,
          brierScore: 0.2,
          closingLineValue: 0.01
        }
      }
    };

    const profile = buildDecisionLearningProfileFromSnapshot(snapshot, {
      activePromotion: promotion(),
      requireDurablePromotion: true
    });

    expect(profile.active).toBe(true);
  });

  it("allows only pending-to-final settlement and never rewrites a final label", () => {
    expect(classifyPredictionOutcomeTransition(null, "pending")).toBe("insert");
    expect(classifyPredictionOutcomeTransition("pending", "pending")).toBe("reuse");
    expect(classifyPredictionOutcomeTransition("pending", "won")).toBe("settle");
    expect(classifyPredictionOutcomeTransition("won", "won")).toBe("reuse");
    expect(classifyPredictionOutcomeTransition("won", "lost")).toBe("reject");
  });

  it("recognizes a uniqueness conflict so a concurrent scheduler retry can safely re-read the stored outcome", () => {
    expect(isPredictionOutcomeIdempotencyConflict({ code: "23505", message: "duplicate key value violates unique constraint" })).toBe(true);
    expect(isPredictionOutcomeIdempotencyConflict({ message: "duplicate key value violates unique constraint" })).toBe(true);
    expect(isPredictionOutcomeIdempotencyConflict({ code: "42501", message: "permission denied" })).toBe(false);
  });
});
