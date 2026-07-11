import { describe, expect, it } from "vitest";
import { mockSportsDataProvider } from "@/lib/sports/providers/mockProvider";
import { buildFootballProviderLiveActivationReceipt } from "@/lib/sports/training/footballProviderLiveActivationReceipt";
import { buildFootballProviderLiveBriefingPacket } from "@/lib/sports/training/footballProviderLiveBriefingPacket";
import { runFootballProviderLiveAIReviewReceipt } from "@/lib/sports/training/footballProviderLiveAIReviewReceipt";
import { buildFootballProviderLiveFeatureMaterializer } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import { observeFootballProviderLiveFeatureStorageReceipt } from "@/lib/sports/training/footballProviderLiveFeatureStorageReceipt";
import { buildFootballProviderLiveWatchlistReceipt } from "@/lib/sports/training/footballProviderLiveWatchlistReceipt";
import type { Match } from "@/lib/sports/types";

const READY_ENV = {
  OPENAI_API_KEY: "sk-proj-test_key_value_1234567890",
  OPENAI_DECISION_MODEL: "gpt-test",
  SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
  SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
  ODDSPADI_ADMIN_TOKEN: "admin-token"
};

function providerBackedMatch(match: Match): Match {
  return {
    ...match,
    oddsMarkets: match.oddsMarkets.map((market) =>
      market.id === "match_winner"
        ? {
            ...market,
            selections: market.selections.map((selection) => ({
              ...selection,
              decimalOdds: selection.id === "home" ? 2.4 : selection.id === "draw" ? 3.9 : 5.4
            }))
          }
        : market
    ),
    dataSource: {
      ...(match.dataSource ?? {}),
      kind: "provider",
      fixtureProvider: "the-odds-api-events",
      oddsProvider: "the-odds-api",
      fetchedAt: "2026-07-05T10:00:00.000Z"
    }
  };
}

function withStoredLiveReadback<T extends { payload: { rows: any[] }; readback: any; controls: any }>(receipt: T): T {
  const rows = receipt.payload.rows.map((row, index) => {
    const features = row.features ?? {};
    const targets = row.targets ?? {};
    return {
      id: `stored-live-row-${index + 1}`,
      fixtureExternalId: row.fixture_external_id,
      modelKey: row.model_key,
      split: "live" as const,
      source: row.source,
      label: row.label ?? null,
      featureHash: row.feature_hash ?? null,
      settlementStatus: targets.settlementStatus ?? "pending",
      rawPayloadLinked: features.evidence?.rawPayloadLinked === true,
      fixtureProvider: features.dataSource?.fixtureProvider ?? null,
      oddsProvider: features.dataSource?.oddsProvider ?? null,
      matchLabel: `${features.homeTeam?.name ?? "Home"} vs ${features.awayTeam?.name ?? "Away"}`,
      league: features.league?.name ?? null,
      generatedAt: row.generated_at ?? null,
      createdAt: row.created_at ?? null
    };
  });
  return {
    ...receipt,
    readback: { checked: true, evidenceReady: rows.length > 0, matchedRows: rows.length, rows, error: null },
    controls: { ...receipt.controls, canUseStoredMonitorEvidence: rows.length > 0 }
  } as T;
}

async function liveActivation() {
  const matches = (await mockSportsDataProvider.getFixtures("2026-08-21", "football")).slice(0, 1).map(providerBackedMatch);
  const runtime = {
    source: "provider-backed" as const,
    providerLabel: "the-odds-api-events+the-odds-api",
    targetDate: "2026-08-21",
    filters: { league: null, country: null, query: null },
    matches,
    runtime: {
      runtimeProvider: "providerBackedSportsDataProvider" as const,
      liveRuntimeBacked: true,
      sportsApiConfigured: true,
      oddsApiConfigured: true,
      weatherApiConfigured: false
    },
    proof: {
      apiFootballConfigured: true,
      oddsConfigured: true,
      providerBackedFixtures: matches.length,
      mockSeedFixtures: 0,
      completeOddsFixtures: matches.length,
      rawPayloadLinkedFixtures: matches.length,
      missing: []
    }
  };
  const materializer = buildFootballProviderLiveFeatureMaterializer({
    provider: runtime.providerLabel,
    matches,
    targetDate: runtime.targetDate,
    now: new Date("2026-07-05T10:00:00.000Z")
  });
  const storage = await observeFootballProviderLiveFeatureStorageReceipt({
    materializer,
    runRequested: false,
    adminAuthorized: false,
    env: READY_ENV,
    origin: "http://127.0.0.1:3025",
    now: new Date("2026-07-05T10:01:00.000Z")
  });
  const watchlist = buildFootballProviderLiveWatchlistReceipt({
    materializer,
    now: new Date("2026-07-05T10:02:00.000Z")
  });
  const briefing = buildFootballProviderLiveBriefingPacket({
    watchlist,
    now: new Date("2026-07-05T10:03:00.000Z")
  });
  const activation = buildFootballProviderLiveActivationReceipt({
    runtime,
    materializer,
    storage: withStoredLiveReadback(storage),
    watchlist,
    briefing,
    now: new Date("2026-07-05T10:04:00.000Z")
  });

  expect(activation.status).toBe("provider-monitor-ready");
  return { activation, briefing };
}

describe("football provider live AI review provider errors", () => {
  it("keeps monitor-only fallback and records redacted quota details", async () => {
    const { activation, briefing } = await liveActivation();
    const receipt = await runFootballProviderLiveAIReviewReceipt({
      activation,
      briefing,
      runRequested: true,
      env: READY_ENV,
      apiKey: READY_ENV.OPENAI_API_KEY,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "insufficient_quota",
              code: "insufficient_quota",
              message: "Project does not have enough quota for this model."
            }
          }),
          { status: 429, headers: { "Content-Type": "application/json", "x-request-id": "req_quota_test" } }
        ),
      now: new Date("2026-07-05T10:05:00.000Z")
    });

    expect(receipt.status).toBe("quota-or-billing-blocked");
    expect(receipt.provider).toBe("openai");
    expect(receipt.latestRun.reason).toContain("HTTP 429");
    expect(receipt.latestRun.reason).toContain("insufficient_quota");
    expect(receipt.latestRun.reason).toContain("req_quota_test");
    expect(receipt.latestRun.reason).not.toContain(READY_ENV.OPENAI_API_KEY);
    expect(receipt.appliedReview.recommendedAction).toBe("monitor");
    expect(receipt.controls.canApplyAI).toBe(false);
    expect(receipt.controls.canPersist).toBe(false);
    expect(receipt.controls.canPublish).toBe(false);
    expect(receipt.controls.canTrain).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });

  it("separates model/request failures from quota failures", async () => {
    const { activation, briefing } = await liveActivation();
    const receipt = await runFootballProviderLiveAIReviewReceipt({
      activation,
      briefing,
      runRequested: true,
      env: READY_ENV,
      apiKey: READY_ENV.OPENAI_API_KEY,
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            error: {
              type: "invalid_request_error",
              code: "model_not_found",
              param: "model",
              message: "The selected model does not exist or is unavailable."
            }
          }),
          { status: 404, headers: { "Content-Type": "application/json", "x-request-id": "req_model_test" } }
        ),
      now: new Date("2026-07-05T10:05:00.000Z")
    });

    expect(receipt.status).toBe("model-or-request-error");
    expect(receipt.summary).toContain("model or request");
    expect(receipt.latestRun.reason).toContain("model_not_found");
    expect(receipt.latestRun.reason).toContain("req_model_test");
    expect(receipt.appliedReview.recommendedAction).toBe("monitor");
    expect(receipt.controls.canPublish).toBe(false);
    expect(receipt.controls.canTrain).toBe(false);
  });
});
