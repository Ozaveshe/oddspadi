import { describe, expect, it, vi } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction } from "@/lib/sports/service";
import {
  runDecisionAutonomousCycle,
  type DecisionAutonomousCycleDependencies
} from "@/lib/sports/prediction/decisionAutonomousCycle";
import {
  buildDecisionRunInputHash,
  type DecisionRunLookupResult
} from "@/lib/sports/prediction/decisionPersistence";
import type { PredictionOutcomeWriteResult } from "@/lib/sports/prediction/decisionOutcomes";

type TestPredictionRow = Awaited<ReturnType<DecisionAutonomousCycleDependencies["getPredictions"]>>[number];

async function row() {
  const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
  const providerMatch = {
    ...match,
    dataSource: {
      ...match.dataSource,
      kind: "provider" as const,
      fixtureProvider: "api-football",
      fixtureProviderId: "123456",
      oddsProvider: "the-odds-api",
      oddsProviderEventId: "odds-event-1"
    }
  };
  return { match: providerMatch, prediction: buildPrediction(providerMatch) };
}

function dependenciesFor(predictionRow: TestPredictionRow) {
  const getPredictions = vi.fn(async () => [predictionRow]);
  const findDecisionRunByInput = vi.fn(async (): Promise<DecisionRunLookupResult> => ({ status: "not-found" }));
  const runOpenAIDecisionAgentReview = vi.fn(async () => ({
    requested: true,
    provider: "openai" as const,
    status: "reviewed" as const,
    model: "gpt-test",
    review: null,
    decision: {
      ...predictionRow.prediction.decision,
      llmEnhanced: true,
      llmModel: "gpt-test",
      llmStatus: "enhanced" as const,
      aiAgentReviewed: true,
      aiAgentStatus: "reviewed" as const
    }
  }));
  const persistDecisionRun = vi.fn(async () => ({
    requested: true,
    status: "stored" as const,
    configured: true,
    table: "op_decision_runs" as const,
    id: "run-1",
    evidenceBundle: {
      status: "stored" as const,
      configured: true,
      table: "op_decision_evidence_bundles" as const,
      id: "bundle-1",
      evidenceHash: "evidence-1",
      decisionHash: "decision-1"
    }
  }));
  const storePredictionOutcome = vi.fn(async (): Promise<PredictionOutcomeWriteResult> => ({
    status: "stored" as const,
    configured: true,
    table: "op_prediction_outcomes" as const,
    id: "outcome-1"
  }));

  return {
    dependencies: {
      getPredictions,
      findDecisionRunByInput,
      runOpenAIDecisionAgentReview,
      persistDecisionRun,
      storePredictionOutcome
    } as DecisionAutonomousCycleDependencies,
    getPredictions,
    findDecisionRunByInput,
    runOpenAIDecisionAgentReview,
    persistDecisionRun,
    storePredictionOutcome
  };
}

describe("autonomous decision cycle", () => {
  it("runs grounded AI review and persists the final decision", async () => {
    const predictionRow = await row();
    const mocks = dependenciesFor(predictionRow);
    const cycle = await runDecisionAutonomousCycle({
      date: "2026-08-21",
      runRequested: true,
      adminAuthorized: true,
      fixtureLimit: 1,
      aiReviewLimit: 1,
      dependencies: mocks.dependencies,
      now: new Date("2026-07-10T05:30:00.000Z")
    });

    expect(cycle.status).toBe("completed");
    expect(cycle.counts).toMatchObject({ selected: 1, aiReviewed: 1, persisted: 1, outcomesStored: 1, persistenceFailed: 0 });
    expect(cycle.decisions[0].ai.status).toBe("reviewed");
    expect(cycle.decisions[0].evidenceHash).toMatch(/^fnv1a-[a-f0-9]{8}$/);
    expect(mocks.runOpenAIDecisionAgentReview).toHaveBeenCalledTimes(1);
    expect(mocks.persistDecisionRun).toHaveBeenCalledTimes(1);
    expect(mocks.persistDecisionRun).toHaveBeenCalledWith(
      expect.objectContaining({ aiAgent: expect.objectContaining({ provider: "openai", status: "reviewed" }) })
    );
    expect(mocks.storePredictionOutcome).toHaveBeenCalledTimes(1);
  });

  it("reuses an existing reviewed evidence hash without another AI call or write", async () => {
    const predictionRow = await row();
    const mocks = dependenciesFor(predictionRow);
    mocks.findDecisionRunByInput.mockResolvedValue({
      status: "found",
      run: {
        id: "stored-run",
        inputHash: buildDecisionRunInputHash(predictionRow),
        llmEnhanced: true,
        llmStatus: "enhanced",
        verdict: predictionRow.prediction.decision.verdict,
        action: predictionRow.prediction.decision.action,
        summary: "Stored grounded review.",
        recommendedSelection: predictionRow.prediction.decision.recommendedSelection
      }
    });
    mocks.storePredictionOutcome.mockResolvedValue({
      status: "reused",
      configured: true,
      table: "op_prediction_outcomes",
      id: "stored-outcome"
    });

    const cycle = await runDecisionAutonomousCycle({
      date: "2026-08-21",
      runRequested: true,
      adminAuthorized: true,
      fixtureLimit: 1,
      aiReviewLimit: 1,
      dependencies: mocks.dependencies
    });

    expect(cycle.status).toBe("partial");
    expect(cycle.counts).toMatchObject({ aiReviewed: 0, aiReused: 1, reused: 1, evidenceBundlesUnverified: 1, outcomesReused: 1 });
    expect(cycle.decisions[0].ai.status).toBe("reused");
    expect(cycle.decisions[0].persistence.status).toBe("reused");
    expect(mocks.runOpenAIDecisionAgentReview).not.toHaveBeenCalled();
    expect(mocks.persistDecisionRun).not.toHaveBeenCalled();
    expect(mocks.storePredictionOutcome).toHaveBeenCalledTimes(1);
  });

  it("keeps preview mode read-only and blocks unauthorized execution", async () => {
    const predictionRow = await row();
    const previewMocks = dependenciesFor(predictionRow);
    const preview = await runDecisionAutonomousCycle({
      date: "2026-08-21",
      fixtureLimit: 1,
      dependencies: previewMocks.dependencies
    });

    expect(preview.status).toBe("preview");
    expect(preview.decisions[0].persistence.status).toBe("skipped");
    expect(previewMocks.findDecisionRunByInput).not.toHaveBeenCalled();
    expect(previewMocks.runOpenAIDecisionAgentReview).not.toHaveBeenCalled();
    expect(previewMocks.persistDecisionRun).not.toHaveBeenCalled();
    expect(previewMocks.storePredictionOutcome).not.toHaveBeenCalled();

    const blockedMocks = dependenciesFor(predictionRow);
    const blocked = await runDecisionAutonomousCycle({
      date: "2026-08-21",
      runRequested: true,
      adminAuthorized: false,
      dependencies: blockedMocks.dependencies
    });
    expect(blocked.status).toBe("blocked");
    expect(blockedMocks.getPredictions).not.toHaveBeenCalled();
  });

  it("rejects fallback and seeded fixtures before AI review or persistence", async () => {
    const [fallbackMatch] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const fallbackRow = { match: fallbackMatch, prediction: buildPrediction(fallbackMatch) };
    const mocks = dependenciesFor(fallbackRow);

    const cycle = await runDecisionAutonomousCycle({
      date: "2026-08-21",
      runRequested: true,
      adminAuthorized: true,
      fixtureLimit: 1,
      aiReviewLimit: 1,
      dependencies: mocks.dependencies
    });

    expect(cycle.status).toBe("no-fixtures");
    expect(cycle.provider).toMatchObject({ fixturesObserved: 0, actionableFixtures: 0, rejectedFallbackFixtures: 1 });
    expect(cycle.counts.selected).toBe(0);
    expect(mocks.findDecisionRunByInput).not.toHaveBeenCalled();
    expect(mocks.runOpenAIDecisionAgentReview).not.toHaveBeenCalled();
    expect(mocks.persistDecisionRun).not.toHaveBeenCalled();
    expect(mocks.storePredictionOutcome).not.toHaveBeenCalled();
  });

  it("keeps fetch timestamps out of identity while including decision-affecting case memory", async () => {
    const predictionRow = await row();
    const firstHash = buildDecisionRunInputHash(predictionRow);
    const secondHash = buildDecisionRunInputHash({
      match: {
        ...predictionRow.match,
        dataSource: predictionRow.match.dataSource
          ? { ...predictionRow.match.dataSource, fetchedAt: "2026-07-10T05:45:00.000Z" }
          : undefined
      },
      prediction: { ...predictionRow.prediction, generatedAt: "2026-07-10T05:45:00.000Z" }
    });
    const changedMemoryHash = buildDecisionRunInputHash({
      ...predictionRow,
      prediction: {
        ...predictionRow.prediction,
        decision: {
          ...predictionRow.prediction.decision,
          caseMemory: {
            ...predictionRow.prediction.decision.caseMemory,
            sampleSize: predictionRow.prediction.decision.caseMemory.sampleSize + 1,
            summary: "A newly stored run changed memory but not provider evidence."
          }
        }
      }
    });
    const changedEvidenceHash = buildDecisionRunInputHash({
      ...predictionRow,
      match: { ...predictionRow.match, dataQualityScore: predictionRow.match.dataQualityScore - 1 }
    });

    expect(secondHash).toBe(firstHash);
    expect(changedMemoryHash).not.toBe(firstHash);
    expect(changedEvidenceHash).not.toBe(firstHash);
  });
});
