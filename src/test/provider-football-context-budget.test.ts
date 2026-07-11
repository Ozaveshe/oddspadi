import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import type { Match, SportsDataProvider } from "@/lib/sports/types";

const fixedNow = new Date("2026-08-21T12:00:00.000Z");

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function fallbackProvider(fixtures: Match[] = []): SportsDataProvider {
  return {
    getFixtures: vi.fn(async () => fixtures),
    getMatch: vi.fn(async () => null),
    getLiveScores: vi.fn(async () => []),
    getOdds: vi.fn(async () => []),
    getTeamForm: vi.fn(async (teamId) => ({
      teamId,
      recentResults: [],
      goalsFor: 0,
      goalsAgainst: 0,
      attackStrength: 1,
      defenseStrength: 1
    }))
  };
}

function fixture(id: number, kickoff: string, status: string, homeId: number, awayId: number) {
  return {
    fixture: { id, date: kickoff, status: { short: status } },
    league: { id: 39, name: "Premier League", country: "England", season: 2026 },
    teams: {
      home: { id: homeId, name: `Home ${homeId}` },
      away: { id: awayId, name: `Away ${awayId}` }
    },
    goals: { home: null, away: null }
  };
}

function fixtureIdsFor(calls: URL[], pathname: string): string[] {
  return calls
    .filter((url) => url.hostname === "v3.football.api-sports.io" && url.pathname === pathname)
    .map((url) => url.searchParams.get("fixture"))
    .filter((fixtureId): fixtureId is string => Boolean(fixtureId))
    .sort();
}

describe("API-Football context request budget", () => {
  it("keeps standings and recent form while skipping distant and scheduled context calls", async () => {
    const calls: URL[] = [];
    const fallback = fallbackProvider();
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_FOOTBALL_KEY: "football-key" },
      now: () => fixedNow,
      fallback,
      historicalFootballEloLoader: async () => new Map(),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        calls.push(url);

        if (url.hostname !== "v3.football.api-sports.io") return new Response("not found", { status: 404 });
        if (url.pathname === "/fixtures" && url.searchParams.has("date")) {
          return jsonResponse({
            response: [
              fixture(1001, "2026-08-29T15:00:00Z", "NS", 1, 2),
              fixture(1002, "2026-08-21T15:00:00Z", "NS", 3, 4),
              fixture(1003, "2026-08-21T11:30:00Z", "1H", 5, 6)
            ]
          });
        }
        if (url.pathname === "/fixtures" && url.searchParams.has("team")) return jsonResponse({ response: [] });
        if (url.pathname === "/standings") return jsonResponse({ response: [] });
        if (["/fixtures/lineups", "/injuries", "/fixtures/events"].includes(url.pathname)) return jsonResponse({ response: [] });

        return new Response("not found", { status: 404 });
      }
    });

    const matches = await provider.getFixtures("2026-08-21", "football");

    expect(matches).toHaveLength(3);
    expect(fallback.getFixtures).not.toHaveBeenCalled();
    expect(calls.filter((url) => url.pathname === "/standings")).toHaveLength(1);
    expect(
      calls
        .filter((url) => url.pathname === "/fixtures" && url.searchParams.has("team"))
        .map((url) => url.searchParams.get("team"))
        .sort()
    ).toEqual(["1", "2", "3", "4", "5", "6"]);

    expect(fixtureIdsFor(calls, "/fixtures/lineups")).toEqual(["1002", "1003"]);
    expect(fixtureIdsFor(calls, "/injuries")).toEqual(["1002", "1003"]);
    expect(fixtureIdsFor(calls, "/fixtures/events")).toEqual(["1003"]);
  });

  it("keeps the existing fixture fallback when API-Football cannot return a slate", async () => {
    const fallbackFixtures = [{ id: "fallback:fixture" } as Match];
    const fallback = fallbackProvider(fallbackFixtures);
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_FOOTBALL_KEY: "football-key" },
      now: () => fixedNow,
      fallback,
      fetchImpl: async () => new Response("unavailable", { status: 503 })
    });

    await expect(provider.getFixtures("2026-08-21", "football")).resolves.toBe(fallbackFixtures);
    expect(fallback.getFixtures).toHaveBeenCalledWith("2026-08-21", "football");
  });
});
