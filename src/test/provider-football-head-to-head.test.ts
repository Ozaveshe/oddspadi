import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import type { Match } from "@/lib/sports/types";

const match = { sport: "football", homeTeam: { id: "api-football:1", name: "Arsenal" }, awayTeam: { id: "api-football:2", name: "Chelsea" } } as Match;

describe("API-Football head-to-head", () => {
  it("uses the controlled provider request and caches a structured aggregate", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(input); expect(url.pathname).toBe("/fixtures/headtohead"); expect(url.searchParams.get("h2h")).toBe("1-2"); expect(url.searchParams.get("last")).toBe("8");
      return new Response(JSON.stringify({ response: [
        { fixture: { id: 10, date: "2026-01-01T15:00:00Z" }, teams: { home: { name: "Arsenal" }, away: { name: "Chelsea" } }, goals: { home: 2, away: 1 } },
        { fixture: { id: 11, date: "2025-09-01T15:00:00Z" }, teams: { home: { name: "Chelsea" }, away: { name: "Arsenal" } }, goals: { home: 0, away: 0 } }
      ] }), { headers: { "content-type": "application/json" } });
    });
    const provider = new ProviderBackedSportsDataProvider({ env: { API_FOOTBALL_KEY: "test" }, fetchImpl, now: () => new Date("2026-07-13T00:00:00Z") });
    const first = await provider.getFootballHeadToHead(match); const second = await provider.getFootballHeadToHead(match);
    expect(first).toMatchObject({ source: "api-football-headtohead", homeWins: 1, draws: 1, awayWins: 0 });
    expect(first?.meetings).toHaveLength(2); expect(second).toEqual(first); expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("does not spend provider quota for non-provider team identities", async () => {
    const fetchImpl = vi.fn(); const provider = new ProviderBackedSportsDataProvider({ env: { API_FOOTBALL_KEY: "test" }, fetchImpl });
    expect(await provider.getFootballHeadToHead({ ...match, homeTeam: { ...match.homeTeam, id: "mock:arsenal" } })).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
