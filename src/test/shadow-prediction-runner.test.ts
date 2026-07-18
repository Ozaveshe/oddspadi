import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildDecisionLearningProfileFromSnapshot } from "@/lib/sports/prediction/decisionLearningProfile";

const getSupabaseRuntimeStatus = vi.hoisted(() => vi.fn());
const getSupabaseServerClient = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase/server", () => ({ getSupabaseRuntimeStatus, getSupabaseServerClient }));

import { buildShadowPredictionDraft, storeShadowPrediction } from "@/lib/sports/prediction/shadowPredictionRepository";
import { buildPrediction } from "@/lib/sports/service";
import type { ShadowModelArtifact } from "@/lib/sports/prediction/shadowModelArtifact";
import type { TrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

async function fixture() {
  const [base] = await mockSportsDataProvider.getFixtures("2026-08-21", "football");
  return {
    ...base,
    status: "scheduled" as const,
    homeTeam: {
      ...base.homeTeam,
      ratingEvidence: { ...base.homeTeam.ratingEvidence, source: "provider-historical-elo", sampleSize: 30 }
    },
    awayTeam: {
      ...base.awayTeam,
      ratingEvidence: { ...base.awayTeam.ratingEvidence, source: "provider-historical-elo", sampleSize: 30 }
    },
    dataSource: {
      ...base.dataSource,
      kind: "provider" as const,
      fixtureProvider: "api-football",
      fixtureProviderId: "fixture-1",
      oddsProvider: "the-odds-api",
      oddsProviderEventId: "odds-1"
    }
  };
}

function artifact(weightScale: number): ShadowModelArtifact {
  const profile = buildDecisionLearningProfileFromSnapshot({
    generatedAt: "2026-07-18T00:00:00.000Z",
    sport: "football",
    status: "not-configured",
    configured: false,
    reason: "test",
    counts: { realFinishedFixtures: 0, demoFinishedFixtures: 0 },
    latestBacktest: null,
    readiness: { readyForTraining: false, minimumRecommendedFixtures: 1000, detail: "test" }
  } as TrainingDataSnapshot, { activePromotion: null, requireDurablePromotion: true });
  return {
    version: "shadow-model-artifact-v1",
    sport: "football",
    modelKey: `football-poisson-v3-shadow-mp-${String(weightScale).replace(".", "")}`,
    baseModelKey: "football-poisson-v3",
    engineVersion: "decision-engine-v1",
    artifactHash: `artifact-${weightScale}`,
    sourceBacktestId: "backtest-1",
    sourceBacktestCreatedAt: "2026-07-01T00:00:00.000Z",
    frozenWindowEnd: "2026-06-30T00:00:00.000Z",
    baselineMarketPriorWeightScale: 1,
    candidateMarketPriorWeightScale: weightScale,
    validation: {
      sampleSize: 60,
      baselineBrierScore: 0.23,
      baselineLogLoss: 0.65,
      candidateBrierScore: 0.21,
      candidateLogLoss: 0.62,
      historicalVerdict: "validated-proper-score-improvement"
    },
    modelOverride: {
      modelKey: `football-poisson-v3-shadow-mp-${String(weightScale).replace(".", "")}`,
      learningProfile: { ...profile, active: true, status: "active" },
      marketPriorWeightScale: weightScale
    },
    controls: { preKickoffOnly: true, exactChampionSelectionOnly: true, publicExposure: false, automaticPromotion: false }
  };
}

describe("private shadow prediction runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSupabaseRuntimeStatus.mockReturnValue({ serverWriteReady: true, missingServerEnv: [] });
  });

  it("creates a pre-kickoff challenger probability for the champion's exact selection", async () => {
    const match = await fixture();
    const now = new Date("2026-07-18T04:30:00.000Z");
    const champion = buildPrediction(match, { now });
    const market = champion.markets.find((candidate) => match.oddsMarkets.some((odds) => odds.id === candidate.marketId))!;
    const selection = Object.keys(market.probabilities)[0]!;
    const modelProbability = market.probabilities[selection]!;
    const result = buildShadowPredictionDraft({
      match,
      championPrediction: champion,
      championOutcomeId: "outcome-1",
      championOutcome: {
        decisionRunId: "run-1",
        fixtureExternalId: match.id,
        sport: "football",
        market: market.marketId,
        selection,
        modelProbability,
        result: "pending"
      },
      artifact: artifact(3),
      now
    });

    expect(result.status, result.status === "ready" ? undefined : result.reason).toBe("ready");
    expect(result).toMatchObject({
      status: "ready",
      draft: {
        championOutcomeId: "outcome-1",
        championDecisionRunId: "run-1",
        fixtureExternalId: match.id,
        market: market.marketId,
        selection,
        championModelProbability: modelProbability,
        modelKey: expect.stringContaining("shadow-mp"),
        metadata: { privateShadow: true, publicExposure: false, automaticPromotion: false }
      }
    });
    expect(result.status === "ready" && result.draft.modelProbability).not.toBe(modelProbability);
  });

  it("rejects fallback, live, and mismatched champion evidence", async () => {
    const match = await fixture();
    const now = new Date("2026-07-18T04:30:00.000Z");
    const champion = buildPrediction(match, { now });
    const base = {
      championPrediction: champion,
      championOutcomeId: "outcome-1",
      championOutcome: {
        decisionRunId: "run-1",
        fixtureExternalId: match.id,
        sport: "football" as const,
        market: champion.markets[0]!.marketId,
        selection: Object.keys(champion.markets[0]!.probabilities)[0]!,
        modelProbability: Object.values(champion.markets[0]!.probabilities)[0]!,
        result: "pending" as const
      },
      artifact: artifact(0),
      now
    };

    expect(buildShadowPredictionDraft({ ...base, match: { ...match, dataSource: { ...match.dataSource!, kind: "mock" } } })).toMatchObject({ status: "not-applicable" });
    expect(buildShadowPredictionDraft({ ...base, match: { ...match, status: "live" } })).toMatchObject({ status: "not-applicable" });
    expect(buildShadowPredictionDraft({ ...base, match, championOutcome: { ...base.championOutcome, fixtureExternalId: "other" } })).toMatchObject({ status: "failed" });
    expect(buildShadowPredictionDraft({ ...base, match, championPrediction: { ...champion, matchId: "other" } })).toMatchObject({ status: "failed", reason: expect.stringContaining("does not match") });
    expect(buildShadowPredictionDraft({ ...base, match, championOutcome: { ...base.championOutcome, modelProbability: base.championOutcome.modelProbability + 0.01 } })).toMatchObject({ status: "failed", reason: expect.stringContaining("does not match") });
  });

  it("reuses an identical immutable row when another worker wins the insert race", async () => {
    const match = await fixture();
    const now = new Date("2026-07-18T04:30:00.000Z");
    const champion = buildPrediction(match, { now });
    const market = champion.markets.find((candidate) => match.oddsMarkets.some((odds) => odds.id === candidate.marketId))!;
    const selection = Object.keys(market.probabilities)[0]!;
    const championOutcome = {
      decisionRunId: "run-1",
      fixtureExternalId: match.id,
      sport: "football" as const,
      market: market.marketId,
      selection,
      modelProbability: market.probabilities[selection]!,
      result: "pending" as const
    };
    const challenger = artifact(3);
    const built = buildShadowPredictionDraft({ match, championPrediction: champion, championOutcome, championOutcomeId: "outcome-1", artifact: challenger, now });
    expect(built.status).toBe("ready");
    if (built.status !== "ready") throw new Error(built.reason);

    const shadowQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn()
        .mockResolvedValueOnce({ data: null, error: null })
        .mockResolvedValueOnce({ data: { id: "shadow-race", input_hash: built.draft.inputHash, model_probability: built.draft.modelProbability }, error: null }),
      insert: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({ data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } })
    };
    const modelVersionQuery = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: { id: "model-1", config: { shadowArtifact: { artifactHash: challenger.artifactHash } } }, error: null })
    };
    const client = {
      from: vi.fn((table: string) => table === "op_shadow_predictions" ? shadowQuery : modelVersionQuery)
    };
    getSupabaseServerClient.mockReturnValue(client);

    await expect(storeShadowPrediction({
      match,
      championPrediction: champion,
      championOutcome,
      championOutcomeId: "outcome-1",
      artifact: challenger,
      now
    })).resolves.toMatchObject({ status: "reused", id: "shadow-race", reason: expect.stringContaining("concurrent worker") });
  });
});
