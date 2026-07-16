import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";

function json(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

describe("public provider reads", () => {
  it("does not query stored historical or player-form enrichment", async () => {
    const historicalFootballEloLoader = vi.fn(async () => new Map());
    const playerFormSignalsLoader = vi.fn(async () => new Map());
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_FOOTBALL_KEY: "test-key", NODE_ENV: "production" },
      historicalFootballEloLoader,
      playerFormSignalsLoader,
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === "/fixtures" && url.searchParams.has("date")) {
          return json({ response: [{
            fixture: { id: 900, date: "2026-08-21T18:00:00Z", status: { short: "NS" } },
            league: { id: 39, name: "Premier League", country: "England", season: 2026 },
            teams: { home: { id: 1, name: "Lagos City" }, away: { id: 2, name: "Dakar United" } },
            goals: { home: null, away: null }
          }] });
        }
        return json({ response: [] });
      }
    });

    const matches = await provider.getFixtures("2026-08-21", "football", { storedEnrichment: false });

    expect(matches).toHaveLength(1);
    expect(historicalFootballEloLoader).not.toHaveBeenCalled();
    expect(playerFormSignalsLoader).not.toHaveBeenCalled();
    expect(matches[0].dataSource?.notes).toContain("Chronological player-performance form unavailable (no-data): Stored player-form enrichment is disabled for this public read.");
  });
});
