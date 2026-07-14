import { describe, expect, it } from "vitest";
import { buildTrainingCorpusProof } from "@/lib/sports/training/trainingCorpusProof";

const command = {
  label: "Proof",
  command: "curl.exe -sS http://127.0.0.1:3025/api/sports/decision/training/corpus-proof",
  verifyUrl: "/api/sports/decision/training/corpus-proof",
  safeToRun: true,
  missingEnv: [],
  expectedEvidence: "Read-only proof returns counts and locked write controls."
};

const passGate = (id: string) => ({
  id,
  status: "pass" as const,
  label: id,
  detail: `${id} passed.`,
  unlocks: `${id} can be inspected.`
});

describe("training corpus proof read-only storage containment", () => {
  it("allows shadow corpus inspection when op_ tables verify but mixed schema locks writes", () => {
    const proof = buildTrainingCorpusProof({
      corpusPlan: {
        id: "multi-sport-10-year-core-v1",
        generatedAt: "2026-07-09T00:00:00.000Z",
        status: "ready",
        mode: "multi-sport-corpus-plan",
        dryRun: true,
        seasonFrom: 2016,
        seasonTo: 2025,
        seasons: ["2016"],
        sports: [
          {
            sport: "football",
            status: "ready",
            adapterStatus: "implemented",
            backtestRunnerStatus: "implemented",
            backtestModelKey: "football-poisson-v2",
            runtimeModelKey: "football-poisson-v2",
            runtimeFeatureContractVersion: "football-runtime-features-v2",
            adapter: "api-football",
            seasonFrom: 2016,
            seasonTo: 2025,
            seasonCount: 10,
            targetCompetitions: [],
            estimatedHistoricalMatches: 3800,
            estimatedOddsSnapshots: 11400,
            requiredEnvKeys: [],
            configuredEnvKeys: [],
            missingEnvKeys: [],
            modelFeatures: [],
            signalCoverage: [],
            firstDryRunCommand: command,
            blockers: [],
            warnings: [],
            nextSteps: []
          }
        ],
        sportCount: 1,
        adapterReadySports: 1,
        plannedAdapterSports: 0,
        totalEstimatedHistoricalMatches: 3800,
        totalEstimatedOddsSnapshots: 11400,
        requiredEnvKeys: [],
        configuredEnvKeys: [],
        missingEnvKeys: [],
        blockers: [],
        warnings: [],
        nextSafeCommand: command,
        supabaseExpectedRef: "wncwtzqipnoqwmqlznqn",
        proofUrls: []
      },
      trainingBlueprint: {
        generatedAt: "2026-07-09T00:00:00.000Z",
        mode: "training-data-blueprint",
        blueprintHash: "fnv1a-test",
        status: "ready-dry-run",
        summary: "Ready.",
        seasonWindow: { from: 2016, to: 2025, seasons: ["2016"] },
        corpusTargets: {
          sports: 1,
          totalEstimatedHistoricalMatches: 3800,
          totalEstimatedOddsSnapshots: 11400,
          minimumRecommendedFixturesPerSport: 1000
        },
        storageTables: [],
        sports: [
          {
            sport: "football",
            status: "ready-dry-run",
            adapter: "api-football",
            backtestModelKey: "football-poisson-v2",
            targetCompetitions: 1,
            estimatedHistoricalMatches: 3800,
            estimatedOddsSnapshots: 11400,
            currentCorpus: {
              configured: true,
              realFinishedFixtures: 3800,
              realOddsSnapshots: 11400,
              featureSnapshots: 3800,
              backtestRuns: 1,
              latestBacktestId: "bt-1"
            },
            deficits: {
              realFinishedFixtures: 0,
              realOddsSnapshots: 0,
              featureSnapshots: 0,
              backtestRuns: 0
            },
            gates: [passGate("fixtures"), passGate("odds"), passGate("features"), passGate("backtests")],
            firstSafeCommand: command,
            nextAction: "Review shadow candidate."
          }
        ],
        phases: [],
        nextSafeCommand: command,
        controls: {
          canInspectReadOnly: true,
          canRunDryRun: true,
          canWriteProviderRows: false,
          canTrainModels: false,
          canPublishPicks: false,
          canUpgradePublicAction: false
        },
        blockers: [],
        warnings: [],
        proofUrls: []
      },
      supabaseProofBinder: {
        status: "blocked-cross-project",
        summary: "Mixed schema keeps writes locked.",
        expected: { projectRef: "wncwtzqipnoqwmqlznqn", projectUrl: "https://wncwtzqipnoqwmqlznqn.supabase.co", tableCount: 23, tables: [] },
        observed: {
          credentialStatus: "valid",
          verifiedTableCount: 23
        },
        controls: {
          canUseMcpForSchema: false
        },
        nextProof: command,
        proofUrls: []
      } as any,
      now: new Date("2026-07-09T00:00:00.000Z")
    });

    expect(proof.status).toBe("shadow-ready");
    expect(proof.supabase.blocker).toContain("Mixed-schema authority keeps migrations and writes locked");
    expect(proof.controls.canInspectReadOnly).toBe(true);
    expect(proof.controls.canWriteProviderRows).toBe(false);
    expect(proof.controls.canTrainModels).toBe(false);
    expect(proof.controls.canUseLearnedWeights).toBe(false);
    expect(proof.controls.canPublishPicks).toBe(false);
  });
});
