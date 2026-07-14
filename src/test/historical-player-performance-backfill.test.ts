import { describe, expect, it } from "vitest";
import { runHistoricalProviderBackfill } from "@/lib/sports/training/historicalBackfill";
import type { ProviderSyncResult } from "@/lib/sports/training/providerSync";

function syncResult(dryRun: boolean): ProviderSyncResult {
  return {
    status: dryRun ? "dry-run" : "stored",
    configured: true,
    provider: "api-football",
    dryRun,
    endpoint: "https://provider.example/fixtures",
    fetched: 6,
    normalized: 6,
    playerPerformancesFetched: 80,
    playerPerformancesNormalized: 80,
    playerPerformancesStored: dryRun ? 0 : 80,
    playerPerformancesVerified: dryRun ? 0 : 80,
    ingestion: {
      status: dryRun ? "dry-run" : "stored",
      sport: "football",
      configured: true,
      dryRun,
      provider: "api_football",
      sourceKind: "real",
      rowsReceived: 6,
      rowsWritten: dryRun ? 0 : 98,
      counts: {
        leagues: 1,
        teams: 12,
        fixtures: 6,
        featureRows: 12,
        oddsRows: 0,
        eventRows: 0,
        newsRows: 0,
        standingsRows: 0,
        availabilityRows: 0,
        lineupRows: 0,
        weatherRows: 0,
        featureSnapshots: 6
      },
      errors: []
    }
  };
}

describe("historical player-performance backfill accounting", () => {
  it("reports normalized player rows during a dry run even though stored rows are zero", async () => {
    const result = await runHistoricalProviderBackfill({
      request: { provider: "api-football", league: "39", seasons: [2025], includePlayerStats: true, dryRun: true },
      syncImpl: async () => syncResult(true)
    });

    expect(result.status).toBe("dry-run");
    expect(result.counts.playerPerformanceRows).toBe(80);
    expect(result.counts.playerPerformanceRowsVerified).toBe(0);
  });

  it("reports stored and verified player rows during a write run", async () => {
    const result = await runHistoricalProviderBackfill({
      request: { provider: "api-football", league: "39", seasons: [2025], includePlayerStats: true, dryRun: false },
      syncImpl: async () => syncResult(false)
    });

    expect(result.status).toBe("stored");
    expect(result.counts.playerPerformanceRows).toBe(80);
    expect(result.counts.playerPerformanceRowsVerified).toBe(80);
  });
});
