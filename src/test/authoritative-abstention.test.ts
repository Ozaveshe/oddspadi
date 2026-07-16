import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildPrediction, decisionAllowsPublicPick, getPredictions, getValuePicks } from "@/lib/sports/service";

const getFixturesMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sports/providers/providerBackedProvider", () => ({
  providerBackedSportsDataProvider: {
    getFixtures: getFixturesMock
  }
}));

vi.mock("@/lib/sports/prediction/decisionLearningProfile", () => ({
  getDecisionLearningProfile: vi.fn(async () => {
    throw new Error("No test learning profile");
  })
}));

vi.mock("@/lib/sports/prediction/decisionMemory", () => ({
  getDecisionCaseMemoryBank: vi.fn(async () => undefined)
}));

describe("authoritative public-pick abstention", () => {
  beforeEach(() => {
    getFixturesMock.mockReset();
  });

  it("keeps an abstained decision report while removing actionable top-level confidence and value", async () => {
    const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const prediction = buildPrediction(match);

    expect(prediction.valueEdges.some((edge) => edge.edge > 0 && edge.expectedValue > 0)).toBe(true);
    expect(prediction.decision.calibration.action).toBe("abstain");
    expect(prediction.decision).toBeDefined();
    expect(prediction.bestPick).toEqual({ hasValue: false, label: "No clear value found" });
    expect(prediction.confidence).toBe("low");
    expect(prediction.risk).toBe("high");
  });

  it("does not return an abstained match from value picks or clear a required core-feature blocker", async () => {
    const [match] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
    const prediction = buildPrediction(match);
    const consideredButBlocked = {
      ...prediction.decision,
      action: "consider" as const,
      calibration: { ...prediction.decision.calibration, action: "trust" as const },
      actionability: { ...prediction.decision.actionability, status: "actionable" as const },
      abstentionRules: prediction.decision.abstentionRules.map((rule) => ({ ...rule, triggered: false }))
    };
    getFixturesMock.mockResolvedValue([match]);

    expect(
      consideredButBlocked.dataCoverage.signals.some(
        (signal) => signal.requiredForProduction && (signal.status === "mock" || signal.status === "missing" || signal.status === "stale")
      )
    ).toBe(true);
    expect(decisionAllowsPublicPick(consideredButBlocked)).toBe(false);
    await expect(getValuePicks("2026-08-21", "football")).resolves.toEqual([]);
  });

  it("does not substitute mock fixtures into an explicitly live provider slate", async () => {
    const [mockMatch] = await mockSportsDataProvider.getFixtures("2026-08-21", "basketball");
    getFixturesMock.mockResolvedValue([mockMatch]);

    await expect(
      getPredictions({ date: "2026-08-21", sport: "basketball", providerMode: "live", storageMode: "preview" })
    ).resolves.toEqual([]);
  });

  it("does not treat a future provider fixture as live in the public prediction service", async () => {
    const [mockMatch] = await mockSportsDataProvider.getFixtures("2099-07-16", "basketball");
    const futureProviderMatch = {
      ...mockMatch,
      id: "api-basketball:future-live",
      kickoffTime: "2099-07-16T23:30:00.000Z",
      status: "live" as const,
      dataSource: {
        ...mockMatch.dataSource,
        kind: "provider" as const,
        fixtureProvider: "api-basketball",
        fixtureProviderId: "future-live"
      }
    };
    getFixturesMock.mockResolvedValue([futureProviderMatch]);

    const [row] = await getPredictions({
      date: "2099-07-16",
      sport: "basketball",
      providerMode: "live",
      storageMode: "preview"
    });

    expect(row.match.status).toBe("scheduled");
    expect(row.prediction.canonicalDecision.engineStatus).not.toBe("suspended");
  });
});
