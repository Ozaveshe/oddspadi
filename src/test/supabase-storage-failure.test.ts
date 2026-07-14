import { describe, expect, it, vi } from "vitest";

const failingClient = {
  from: vi.fn((table: string) => ({
    upsert: vi.fn(() => ({
      select: vi.fn(async () => ({ data: null, error: { message: `Invalid API key for ${table}` } }))
    })),
    insert: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: null, error: { message: `Invalid API key for ${table}` } }))
      }))
    }))
  }))
};

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => failingClient)
}));

const READY_ENV = {
  SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
  SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "sb_secret_rejected_test_server_key",
  ODDSPADI_ADMIN_TOKEN: "admin-token"
};

describe("Supabase storage failure gates", () => {
  it("keeps provider feature writes locked when Supabase rejects the key", async () => {
    const { buildDemoFootballProviderFeatureFixture, buildFootballProviderFeatureMaterializer } = await import(
      "@/lib/sports/training/footballDataProviderFeatureMaterializer"
    );
    const { observeFootballProviderFeatureStorageReceipt } = await import("@/lib/sports/training/footballDataProviderFeatureStorageReceipt");
    const materializer = buildFootballProviderFeatureMaterializer({
      provider: "demo_provider",
      fixtures: [buildDemoFootballProviderFeatureFixture()],
      now: new Date("2026-07-05T10:00:00.000Z")
    });

    const receipt = await observeFootballProviderFeatureStorageReceipt({
      materializer,
      runRequested: true,
      adminAuthorized: true,
      env: READY_ENV,
      origin: "http://127.0.0.1:3025",
      now: new Date("2026-07-05T10:01:00.000Z")
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.storage.inserted).toBe(false);
    expect(receipt.storage.error).toContain("Invalid API key");
    expect(receipt.target.serverWriteReady).toBe(true);
    expect(receipt.controls.canWriteFeatureSnapshots).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });

  it("keeps provider-backed live feature writes locked when Supabase rejects the key", async () => {
    const { mockSportsDataProvider } = await import("@/lib/sports/providers/mockProvider");
    const { buildFootballProviderLiveFeatureMaterializer } = await import("@/lib/sports/training/footballProviderLiveFeatureMaterializer");
    const { observeFootballProviderLiveFeatureStorageReceipt } = await import("@/lib/sports/training/footballProviderLiveFeatureStorageReceipt");
    const matches = (await mockSportsDataProvider.getFixtures("2026-08-21", "football")).map((match) => ({
      ...match,
      dataSource: {
        ...(match.dataSource ?? {}),
        kind: "provider" as const,
        fixtureProvider: "the-odds-api-events",
        oddsProvider: "the-odds-api",
        fetchedAt: "2026-07-05T10:00:00.000Z"
      }
    }));
    const materializer = buildFootballProviderLiveFeatureMaterializer({
      provider: "the-odds-api-events+the-odds-api",
      matches,
      targetDate: "2026-08-21",
      now: new Date("2026-07-05T10:00:00.000Z")
    });

    const receipt = await observeFootballProviderLiveFeatureStorageReceipt({
      materializer,
      runRequested: true,
      adminAuthorized: true,
      env: READY_ENV,
      origin: "http://127.0.0.1:3025",
      now: new Date("2026-07-05T10:01:00.000Z")
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.materializer.providerBackedRows).toBeGreaterThan(0);
    expect(receipt.storage.inserted).toBe(false);
    expect(receipt.storage.error).toContain("Invalid API key");
    expect(receipt.controls.canWriteLiveFeatureSnapshots).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });

  it("keeps benchmark persistence locked when Supabase rejects the key", async () => {
    const { observeFootballDataMarketBenchmarkPersistenceReceipt } = await import(
      "@/lib/sports/training/footballDataMarketBenchmarkPersistenceReceipt"
    );
    const benchmark = {
      mode: "football-data-market-benchmark",
      status: "completed",
      summary: "Benchmark complete.",
      request: { seasonFrom: 2016, seasonTo: 2016 },
      corpus: { matchedRows: 8 },
      model: {
        modelKey: "football-poisson-elo-v1",
        sampleSize: 8,
        trainSize: 4,
        testSize: 4,
        pickCount: 2,
        brierScore: 0.2,
        logLoss: 0.6,
        yield: 0.04,
        calibrationError: 0.08
      },
      market: {
        rows: 4,
        brierScore: 0.22,
        logLoss: 0.64,
        averageMargin: 0.05,
        averageDisagreement: 0.12
      },
      comparison: {
        modelBrierDelta: -0.02,
        modelLogLossDelta: -0.04,
        verdict: "model-beats-market"
      },
      recommendation: {
        action: "shadow-review",
        summary: "Store as audit evidence."
      },
      controls: {
        canApplyLearnedWeights: false,
        canPublishPicks: false,
        canStake: false
      }
    };

    const receipt = await observeFootballDataMarketBenchmarkPersistenceReceipt({
      benchmark: benchmark as any,
      runRequested: true,
      adminAuthorized: true,
      env: READY_ENV,
      origin: "http://127.0.0.1:3025",
      now: new Date("2026-07-05T10:01:00.000Z")
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.storage.inserted).toBe(false);
    expect(receipt.storage.error).toContain("Invalid API key");
    expect(receipt.controls.canWriteBacktestRun).toBe(false);
    expect(receipt.controls.canApplyLearnedWeights).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });
});
