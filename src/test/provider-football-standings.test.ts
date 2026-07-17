import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import { currentFootballSeason, featuredFootballLeagueTables, leagueBySlug, leagueSlugFromProviderId, resolveVerifiedLeagueTable, type LeagueTable } from "@/lib/sports/leagueStandings";

describe("football league standings", () => {
  it("maps league slugs and football seasons deterministically", () => { expect(leagueBySlug("premier-league")?.leagueId).toBe("39"); expect(leagueSlugFromProviderId("api-football:39")).toBe("premier-league"); expect(currentFootballSeason(new Date("2026-06-30T12:00:00Z"))).toBe("2025"); expect(currentFootballSeason(new Date("2026-07-01T12:00:00Z"))).toBe("2026"); expect(featuredFootballLeagueTables.map((league) => league.slug)).toEqual(["premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1"]); });
  it("fetches, normalizes, and caches a provider table", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => { const url = new URL(input); expect(url.pathname).toBe("/standings"); expect(url.searchParams.get("league")).toBe("39"); expect(url.searchParams.get("season")).toBe("2026"); return new Response(JSON.stringify({ response: [{ league: { standings: [[{ rank: 1, team: { id: 42, name: "Arsenal" }, points: 12, form: "WWDLW", all: { played: 5, win: 4, draw: 0, lose: 1, goals: { for: 10, against: 3 } } }]] } }] }), { headers: { "content-type": "application/json" } }); });
    const provider = new ProviderBackedSportsDataProvider({ env: { API_FOOTBALL_KEY: "test" }, fetchImpl, now: () => new Date("2026-07-13T00:00:00Z") }); const first = await provider.getFootballLeagueTable("premier-league", "2026"); const second = await provider.getFootballLeagueTable("premier-league", "2026");
    expect(first).toMatchObject({ source: "api-football-standings", leagueName: "Premier League", rows: [{ position: 1, teamName: "Arsenal", played: 5, wins: 4, goalDifference: 7, points: 12, form: "WWDLW" }] }); expect(second).toEqual(first); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
  it("does not cache an empty provider table", async () => {
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      const standings = calls === 1 ? [] : [{ rank: 1, team: { id: 42, name: "Arsenal" }, points: 0, all: { played: 0, win: 0, draw: 0, lose: 0, goals: { for: 0, against: 0 } } }];
      return new Response(JSON.stringify({ response: [{ league: { standings: [standings] } }] }), { headers: { "content-type": "application/json" } });
    });
    const provider = new ProviderBackedSportsDataProvider({ env: { API_FOOTBALL_KEY: "test" }, fetchImpl });

    expect(await provider.getFootballLeagueTable("premier-league", "2026")).toBeNull();
    expect((await provider.getFootballLeagueTable("premier-league", "2026"))?.rows).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
  it("does not call the provider for unknown leagues", async () => { const fetchImpl = vi.fn(); const provider = new ProviderBackedSportsDataProvider({ env: { API_FOOTBALL_KEY: "test" }, fetchImpl }); expect(await provider.getFootballLeagueTable("not-a-league")).toBeNull(); expect(fetchImpl).not.toHaveBeenCalled(); });
  it("uses the latest stored final table when the new season is not published", async () => {
    const historical = { slug: "premier-league", season: "2025", rows: [{ position: 1 }] } as LeagueTable;
    const getCurrent = vi.fn(async () => ({ slug: "premier-league", season: "2026", rows: [] }) as unknown as LeagueTable);
    const getStored = vi.fn(async (_slug: string, season: string) => season === "2025" ? historical : null);

    const result = await resolveVerifiedLeagueTable("premier-league", "2026", getCurrent, getStored);

    expect(result).toEqual({ table: historical, requestedSeason: "2026", displaySeason: "2025", historicalFallback: true });
    expect(getCurrent).toHaveBeenCalledTimes(1);
    expect(getCurrent).toHaveBeenCalledWith("premier-league", "2026");
    expect(getStored.mock.calls).toEqual([["premier-league", "2026"], ["premier-league", "2025"]]);
  });
  it("does not fall back when a current table exists", async () => {
    const current = { slug: "premier-league", season: "2026", rows: [{ position: 1 }] } as LeagueTable;
    const getCurrent = vi.fn(async () => current);
    const getStored = vi.fn(async () => null);

    expect(await resolveVerifiedLeagueTable("premier-league", "2026", getCurrent, getStored)).toEqual({
      table: current,
      requestedSeason: "2026",
      displaySeason: "2026",
      historicalFallback: false,
    });
    expect(getStored).not.toHaveBeenCalled();
  });
  it("can use a previous provider season for a featured league without requiring a stored snapshot", async () => {
    const historical = { slug: "ligue-1", season: "2025", rows: [{ position: 1 }] } as LeagueTable;
    const getCurrent = vi.fn(async () => null);
    const getStored = vi.fn(async () => null);
    const getHistoricalProvider = vi.fn(async () => historical);

    expect(await resolveVerifiedLeagueTable("ligue-1", "2026", getCurrent, getStored, getHistoricalProvider)).toEqual({
      table: historical,
      requestedSeason: "2026",
      displaySeason: "2025",
      historicalFallback: true,
    });
    expect(getHistoricalProvider).toHaveBeenCalledWith("ligue-1", "2025");
    expect(getStored.mock.calls).toEqual([["ligue-1", "2026"]]);
  });
});
