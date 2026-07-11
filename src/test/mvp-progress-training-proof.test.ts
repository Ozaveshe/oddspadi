import { describe, expect, it } from "vitest";
import { buildDecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import type { DecisionProviderEnvDiagnostic } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import type { DecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

describe("MVP progress training proof", () => {
  it("credits stored calibrated corpus evidence while keeping learned promotion guarded", () => {
    const readiness = {
      openAi: { status: "ready" },
      supabase: {
        status: "ready",
        configured: true,
        detail: "OddsPadi storage verified.",
        schema: { foreignSchemaSignals: [] }
      },
      trainingData: {
        status: "warning",
        configured: true,
        detail: "Training storage is configured."
      }
    } as unknown as DecisionEngineReadiness;
    const providerEnvDiagnostic = {
      status: "ready",
      totals: { configuredCriticalLanes: 2, criticalLanes: 2, missing: 0 },
      footballMvpMinimum: { status: "ready", nextAction: "Run provider evidence checks." }
    } as unknown as DecisionProviderEnvDiagnostic;
    const trainingSnapshot = {
      status: "ready",
      sport: "football",
      counts: {
        realFinishedFixtures: 3800,
        realOddsSnapshots: 11400,
        featureSnapshots: 4280,
        backtestRuns: 7
      },
      readiness: {
        readyForTraining: true
      },
      latestBacktest: {
        status: "completed",
        calibrationError: 0.024306,
        calibrationBuckets: [{ id: "p01" }],
        learnedWeights: { minimumEdge: 0.055, valueEdgeWeight: 0.2885, dataQualityWeight: 0.18 }
      }
    } as unknown as TrainingDataSnapshot;

    const progress = buildDecisionMvpProgressSnapshot({
      date: "2026-08-21",
      sport: "football",
      rows: [{ prediction: { bestPick: { hasValue: true }, decision: { action: "monitor" } } }],
      readiness,
      providerEnvDiagnostic,
      trainingSnapshot,
      now: new Date("2026-07-10T00:00:00.000Z")
    });

    const trainingLane = progress.lanes.find((lane) => lane.id === "training-corpus");
    expect(progress.status).toBe("local-mvp-ready");
    expect(trainingLane?.status).toBe("done");
    expect(trainingLane?.percent).toBe(88);
    expect(trainingLane?.evidence).toContain("3800 real finished football fixture(s)");
    expect(trainingLane?.nextAction).toContain("shadow comparison");
    expect(progress.controls.canTrainModels).toBe(false);
    expect(progress.controls.canPublishPicks).toBe(false);
  });
});
