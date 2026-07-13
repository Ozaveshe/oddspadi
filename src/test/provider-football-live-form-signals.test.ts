import { describe, expect, it } from "vitest";
import { ProviderBackedSportsDataProvider, weightedAvailabilityImpact } from "@/lib/sports/providers/providerBackedProvider";
import { modelFootballMatch } from "@/lib/sports/prediction/footballModel";

function response(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function played(id: number, date: string, homeId: number, awayId: number, homeGoals: number, awayGoals: number) {
  return {
    fixture: { id, date, status: { short: "FT" } },
    league: { id: 39, name: "Premier League", country: "England", season: 2026 },
    teams: { home: { id: homeId, name: `Team ${homeId}` }, away: { id: awayId, name: `Team ${awayId}` } },
    goals: { home: homeGoals, away: awayGoals }
  };
}

describe("live provider football form signals", () => {
  it("weights a named starting forward absence above the same reserve-player injury", () => {
    const reserveImpact = weightedAvailabilityImpact("Missing Fixture", "hamstring", null);
    const starterImpact = weightedAvailabilityImpact("Missing Fixture", "hamstring", "F");
    expect(starterImpact).toBeGreaterThan(reserveImpact);
  });

  it("uses venue form, newest-first results, and bounded recent-match xG", async () => {
    const calls: URL[] = [];
    const recentByTeam = {
      "1": [
        played(103, "2026-08-18T18:00:00Z", 1, 8, 3, 0),
        played(102, "2026-08-10T18:00:00Z", 1, 7, 2, 0),
        played(101, "2026-08-02T18:00:00Z", 1, 6, 1, 0),
        played(100, "2026-07-25T18:00:00Z", 5, 1, 4, 0)
      ],
      "2": [
        played(203, "2026-08-17T18:00:00Z", 9, 2, 2, 0),
        played(202, "2026-08-09T18:00:00Z", 8, 2, 1, 0),
        played(201, "2026-08-01T18:00:00Z", 7, 2, 3, 1)
      ]
    };
    const xg: Record<string, Record<string, number>> = {
      "103": { "1": 2.8, "8": 0.4 }, "102": { "1": 2.2, "7": 0.6 }, "101": { "1": 1.9, "6": 0.7 },
      "203": { "9": 1.8, "2": 0.5 }, "202": { "8": 1.6, "2": 0.7 }, "201": { "7": 2.1, "2": 0.8 }
    };
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        API_FOOTBALL_KEY: "test-key",
        API_FOOTBALL_MAX_ENRICHED_FIXTURES: "1",
        API_FOOTBALL_MAX_XG_TEAMS: "2",
        API_FOOTBALL_XG_MATCHES_PER_TEAM: "3"
      },
      now: () => new Date("2026-08-21T10:00:00Z"),
      historicalFootballEloLoader: async () => new Map(),
      fetchImpl: async (input) => {
        const url = new URL(String(input)); calls.push(url);
        if (url.hostname === "api.the-odds-api.com") return response([]);
        if (url.pathname === "/fixtures" && url.searchParams.has("date")) {
          return response({ response: [{ fixture: { id: 900, date: "2026-08-21T18:00:00Z", status: { short: "NS" } }, league: { id: 39, name: "Premier League", country: "England", season: 2026 }, teams: { home: { id: 1, name: "Team 1" }, away: { id: 2, name: "Team 2" } }, goals: { home: null, away: null } }] });
        }
        if (url.pathname === "/fixtures" && url.searchParams.has("team")) return response({ response: recentByTeam[url.searchParams.get("team") as "1" | "2"] ?? [] });
        if (url.pathname === "/fixtures/statistics") {
          const values = xg[url.searchParams.get("fixture") ?? ""] ?? {};
          return response({ response: Object.entries(values).map(([id, value]) => ({ team: { id: Number(id) }, statistics: [{ type: "expected_goals", value }] })) });
        }
        if (url.pathname === "/standings" || ["/fixtures/lineups", "/injuries", "/fixtures/events"].includes(url.pathname)) return response({ response: [] });
        return new Response("not found", { status: 404 });
      }
    });

    const [match] = await provider.getFixtures("2026-08-21", "football");

    expect(match.homeForm.recentResults).toEqual(["W", "W", "W"]);
    expect(match.homeForm.goalsFor).toBe(2);
    expect(match.homeForm.xgFor).toBe(2.3);
    expect(match.homeForm.xgAgainst).toBeCloseTo(0.57, 2);
    expect(match.awayForm.recentResults).toEqual(["L", "L", "L"]);
    expect(match.awayForm.xgFor).toBeCloseTo(0.67, 2);
    expect(calls.filter((url) => url.pathname === "/fixtures/statistics")).toHaveLength(6);
    const venueAware = modelFootballMatch(match).markets[0].probabilities.home;
    const reversedVenueEvidence = modelFootballMatch({ ...match, homeForm: match.awayForm, awayForm: match.homeForm }).markets[0].probabilities.home;
    expect(venueAware).toBeGreaterThan(reversedVenueEvidence);
  });

  it("caps xG fan-out independently of the enriched fixture count", async () => {
    const statisticsCalls: URL[] = [];
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_FOOTBALL_KEY: "test-key", API_FOOTBALL_MAX_ENRICHED_FIXTURES: "2", API_FOOTBALL_MAX_XG_TEAMS: "1", API_FOOTBALL_XG_MATCHES_PER_TEAM: "2" },
      historicalFootballEloLoader: async () => new Map(),
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.hostname === "api.the-odds-api.com") return response([]);
        if (url.pathname === "/fixtures" && url.searchParams.has("date")) return response({ response: [
          { fixture: { id: 900, date: "2026-08-21T18:00:00Z", status: { short: "NS" } }, league: { id: 39, name: "Premier League", country: "England", season: 2026 }, teams: { home: { id: 1, name: "A" }, away: { id: 2, name: "B" } }, goals: {} },
          { fixture: { id: 901, date: "2026-08-21T20:00:00Z", status: { short: "NS" } }, league: { id: 39, name: "Premier League", country: "England", season: 2026 }, teams: { home: { id: 3, name: "C" }, away: { id: 4, name: "D" } }, goals: {} }
        ] });
        if (url.pathname === "/fixtures" && url.searchParams.has("team")) return response({ response: [played(11, "2026-08-10T18:00:00Z", Number(url.searchParams.get("team")), 99, 1, 0), played(10, "2026-08-01T18:00:00Z", Number(url.searchParams.get("team")), 98, 1, 0)] });
        if (url.pathname === "/fixtures/statistics") { statisticsCalls.push(url); return response({ response: [] }); }
        return response({ response: [] });
      }
    });
    await provider.getFixtures("2026-08-21", "football");
    expect(statisticsCalls).toHaveLength(2);
  });
});
