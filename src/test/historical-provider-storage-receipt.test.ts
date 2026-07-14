import { describe, expect, it, vi } from "vitest";
import { observeHistoricalProviderStorageReceipt } from "@/lib/sports/training/historicalProviderStorageReceipt";
import { buildSupabaseTrainingCorpusCensus, type SupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";
import type { HistoricalProviderBackfillResult } from "@/lib/sports/training/historicalBackfill";

const readyEnv = {
  SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
  SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_test",
  ODDSPADI_ADMIN_TOKEN: "admin-token",
  API_FOOTBALL_KEY: "football-key",
  THE_ODDS_API_KEY: "odds-key"
};

function census(fixtures: number, rawProviderPayloads: number, featureSnapshots: number, playerPerformanceRows = 0): SupabaseTrainingCorpusCensus {
  return buildSupabaseTrainingCorpusCensus({
    env: readyEnv,
    projectRef: "wncwtzqipnoqwmqlznqn",
    serverReadReady: true,
    targetMatchesExpected: true,
    counts: [
      {
        sport: "football",
        fixtures,
        finishedFixtures: fixtures,
        epl2026Fixtures: 0,
        oddsSnapshots: 0,
        matchWinnerOddsSnapshots: 0,
        rawProviderPayloads,
        playerPerformanceRows,
        featureSnapshots,
        liveFeatureSnapshots: 0,
        labeledFeatureSnapshots: 0,
        completedBacktests: 0
      }
    ],
    now: new Date("2026-07-10T00:00:00.000Z")
  });
}

function backfillResult(status: HistoricalProviderBackfillResult["status"], dryRun: boolean): HistoricalProviderBackfillResult {
  return {
    status,
    provider: "api-football",
    dryRun,
    plannedJobs: 1,
    executedJobs: 1,
    storedJobs: dryRun ? 0 : 1,
    dryRunJobs: dryRun ? 1 : 0,
    failedJobs: 0,
    fetched: 380,
    normalized: 5,
    counts: {
      fixtures: 5,
      oddsRows: 0,
      eventRows: 18,
      newsRows: 0,
      standingsRows: 4,
      availabilityRows: 18,
      lineupRows: 4,
      playerPerformanceRows: 28,
      playerPerformanceRowsVerified: dryRun ? 0 : 28,
      weatherRows: 0,
      featureSnapshots: 5
    },
    truncated: false,
    warnings: [],
    errors: [],
    jobs: [
      {
        job: {
          id: "api-football:39:season:2025",
          provider: "api-football",
          purpose: "API-Football league 39 season 2025",
          request: {
            provider: "api-football",
            league: "39",
            season: "2025",
            dryRun,
            includeEvents: true,
            includeContext: true
          }
        },
        result: {
          status: dryRun ? "dry-run" : "stored",
          configured: true,
          provider: "api-football",
          dryRun,
          endpoint: "https://v3.football.api-sports.io/fixtures?league=39&season=2025",
          fetched: 380,
          normalized: 5,
          ingestion: {
            status: dryRun ? "dry-run" : "stored",
            sport: "football",
            configured: true,
            dryRun,
            provider: "api_football",
            sourceKind: "real",
            ingestionRunId: dryRun ? undefined : "ingestion-1",
            rowsReceived: 5,
            rowsWritten: dryRun ? 0 : 64,
            counts: {
              leagues: 1,
              teams: 10,
              fixtures: 5,
              featureRows: 10,
              oddsRows: 0,
              eventRows: 18,
              newsRows: 0,
              standingsRows: 4,
              availabilityRows: 18,
              lineupRows: 4,
              weatherRows: 0,
              featureSnapshots: 5
            },
            errors: []
          }
        }
      }
    ]
  };
}

describe("historical provider storage receipt", () => {
  it("previews the capped storage receipt without attempting provider calls", async () => {
    const backfillRunner = vi.fn();
    const receipt = await observeHistoricalProviderStorageReceipt({
      env: readyEnv,
      origin: "http://127.0.0.1:3025",
      backfillRunner,
      censusReader: async () => census(0, 0, 0),
      now: new Date("2026-07-10T00:00:00.000Z")
    });

    expect(receipt.mode).toBe("historical-provider-storage-receipt");
    expect(receipt.status).toBe("ready-to-run");
    expect(backfillRunner).not.toHaveBeenCalled();
    expect(receipt.request.maxJobs).toBe(1);
    expect(receipt.request.maxEventFixtures).toBe(1);
    expect(receipt.request.maxContextFixtures).toBe(2);
    expect(receipt.nextAction.command).toContain("dryRun=1");
    expect(receipt.controls.canRunProviderDryRun).toBe(true);
    expect(receipt.controls.canWriteProviderRows).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
  });

  it("does not spend provider calls when admin authorization is missing", async () => {
    const backfillRunner = vi.fn();
    const receipt = await observeHistoricalProviderStorageReceipt({
      env: readyEnv,
      origin: "http://127.0.0.1:3025",
      runRequested: true,
      adminAuthorized: false,
      backfillRunner,
      censusReader: async () => census(0, 0, 0),
      now: new Date("2026-07-10T00:01:00.000Z")
    });

    expect(receipt.status).toBe("waiting-admin");
    expect(backfillRunner).not.toHaveBeenCalled();
    expect(receipt.observation.attempted).toBe(false);
    expect(receipt.controls.canWriteProviderRows).toBe(false);
  });

  it("runs a capped dry-run without unlocking writes or training", async () => {
    const backfillRunner = vi.fn(async () => backfillResult("dry-run", true));
    const receipt = await observeHistoricalProviderStorageReceipt({
      env: readyEnv,
      origin: "http://127.0.0.1:3025",
      runRequested: true,
      adminAuthorized: true,
      backfillRunner,
      censusReader: async () => census(0, 0, 0),
      now: new Date("2026-07-10T00:02:00.000Z")
    });

    expect(backfillRunner).toHaveBeenCalledOnce();
    expect(backfillRunner).toHaveBeenCalledWith(
      expect.objectContaining({
        request: expect.objectContaining({
          provider: "api-football",
          dryRun: true,
          maxJobs: 1,
          maxEventFixtures: 1,
          maxContextFixtures: 2
        })
      })
    );
    expect(receipt.status).toBe("dry-run-passed");
    expect(receipt.observation.normalized).toBe(5);
    expect(receipt.controls.canWriteProviderRows).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.readback.evidenceReady).toBe(false);
  });

  it("records stored backfill readback evidence while keeping model authority locked", async () => {
    let readCount = 0;
    const receipt = await observeHistoricalProviderStorageReceipt({
      env: readyEnv,
      origin: "http://127.0.0.1:3025",
      request: { dryRun: false, includePlayerStats: true },
      runRequested: true,
      adminAuthorized: true,
      backfillRunner: async () => backfillResult("stored", false),
      censusReader: async () => {
        readCount += 1;
        return readCount === 1 ? census(0, 0, 0) : census(5, 1, 5, 28);
      },
      now: new Date("2026-07-10T00:03:00.000Z")
    });

    expect(receipt.status).toBe("stored");
    expect(receipt.observation.rowsWritten).toBe(64);
    expect(receipt.observation.ingestionRunIds).toEqual(["ingestion-1"]);
    expect(receipt.readback.evidenceReady).toBe(true);
    expect(receipt.readback.fixturesVisible).toBe(5);
    expect(receipt.readback.rawPayloadsVisible).toBe(1);
    expect(receipt.readback.playerPerformancesVisible).toBe(28);
    expect(receipt.controls.canWriteProviderRows).toBe(true);
    expect(receipt.controls.canWriteRawPayloads).toBe(true);
    expect(receipt.controls.canWriteFeatureSnapshots).toBe(true);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canApplyLearnedWeights).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });

  it("does not call a player-stat backfill stored until the player corpus is visible", async () => {
    let readCount = 0;
    const receipt = await observeHistoricalProviderStorageReceipt({
      env: readyEnv,
      origin: "http://127.0.0.1:3025",
      request: { dryRun: false, includePlayerStats: true },
      runRequested: true,
      adminAuthorized: true,
      backfillRunner: async () => backfillResult("stored", false),
      censusReader: async () => {
        readCount += 1;
        return readCount === 1 ? census(0, 0, 0) : census(5, 1, 5, 0);
      },
      now: new Date("2026-07-10T00:03:30.000Z")
    });

    expect(receipt.status).toBe("failed");
    expect(receipt.readback.evidenceReady).toBe(false);
    expect(receipt.readback.playerPerformancesVisible).toBe(0);
    expect(receipt.readback.errors[0]).toContain("census cannot see any real player-performance rows");
  });

  it("records a successful quiet provider window as no-data instead of a failure", async () => {
    const emptyResult = backfillResult("stored", false);
    emptyResult.fetched = 0;
    emptyResult.normalized = 0;
    emptyResult.counts = {
      fixtures: 0,
      oddsRows: 0,
      eventRows: 0,
      newsRows: 0,
      standingsRows: 0,
      availabilityRows: 0,
      lineupRows: 0,
      playerPerformanceRows: 0,
      playerPerformanceRowsVerified: 0,
      weatherRows: 0,
      featureSnapshots: 0
    };
    const ingestion = emptyResult.jobs[0]?.result.ingestion;
    if (ingestion) {
      ingestion.rowsReceived = 0;
      ingestion.rowsWritten = 0;
      ingestion.counts = {
        leagues: 0,
        teams: 0,
        fixtures: 0,
        featureRows: 0,
        oddsRows: 0,
        eventRows: 0,
        newsRows: 0,
        standingsRows: 0,
        availabilityRows: 0,
        lineupRows: 0,
        weatherRows: 0,
        featureSnapshots: 0
      };
    }

    const receipt = await observeHistoricalProviderStorageReceipt({
      env: readyEnv,
      origin: "http://127.0.0.1:3025",
      request: { dryRun: false },
      runRequested: true,
      adminAuthorized: true,
      backfillRunner: async () => emptyResult,
      censusReader: async () => census(0, 0, 0),
      now: new Date("2026-07-10T00:04:00.000Z")
    });

    expect(receipt.status).toBe("no-data");
    expect(receipt.summary).toContain("completed successfully");
    expect(receipt.readback.evidenceReady).toBe(false);
    expect(receipt.nextAction.label).toBe("Wait for the next completed-fixture window");
  });
});
