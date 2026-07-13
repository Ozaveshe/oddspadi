import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import { currentFootballSeason, leagueBySlug, leagueSlugFromProviderId } from "@/lib/sports/leagueStandings";

describe("football league standings", () => {
  it("maps league slugs and football seasons deterministically", () => { expect(leagueBySlug("premier-league")?.leagueId).toBe("39"); expect(leagueSlugFromProviderId("api-football:39")).toBe("premier-league"); expect(currentFootballSeason(new Date("2026-06-30T12:00:00Z"))).toBe("2025"); expect(currentFootballSeason(new Date("2026-07-01T12:00:00Z"))).toBe("2026"); });
  it("fetches, normalizes, and caches a provider table", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => { const url = new URL(input); expect(url.pathname).toBe("/standings"); expect(url.searchParams.get("league")).toBe("39"); expect(url.searchParams.get("season")).toBe("2026"); return new Response(JSON.stringify({ response: [{ league: { standings: [[{ rank: 1, team: { id: 42, name: "Arsenal" }, points: 12, form: "WWDLW", all: { played: 5, win: 4, draw: 0, lose: 1, goals: { for: 10, against: 3 } } }]] } }] }), { headers: { "content-type": "application/json" } }); });
    const provider = new ProviderBackedSportsDataProvider({ env: { API_FOOTBALL_KEY: "test" }, fetchImpl, now: () => new Date("2026-07-13T00:00:00Z") }); const first = await provider.getFootballLeagueTable("premier-league", "2026"); const second = await provider.getFootballLeagueTable("premier-league", "2026");
    expect(first).toMatchObject({ source: "api-football-standings", leagueName: "Premier League", rows: [{ position: 1, teamName: "Arsenal", played: 5, wins: 4, goalDifference: 7, points: 12, form: "WWDLW" }] }); expect(second).toEqual(first); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not call the provider for unknown leagues", async () => { const fetchImpl = vi.fn(); const provider = new ProviderBackedSportsDataProvider({ env: { API_FOOTBALL_KEY: "test" }, fetchImpl }); expect(await provider.getFootballLeagueTable("not-a-league")).toBeNull(); expect(fetchImpl).not.toHaveBeenCalled(); });
});
