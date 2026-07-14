import { describe, expect, it } from "vitest";
import type { HistoricalFootballFixtureInput } from "@/lib/sports/training/historicalIngestion";
import { buildPlayerFormSignal, type PlayerMatchPerformance } from "@/lib/sports/training/playerPerformance";
import {
  normalizeApiFootballPlayerPerformancesForFixture,
  syncHistoricalFootballProvider
} from "@/lib/sports/training/providerSync";

const fixture: HistoricalFootballFixtureInput = {
  externalId: "api-football:101",
  kickoffAt: "2026-07-14T18:00:00.000Z",
  league: { externalId: "api-football:39", name: "Premier League", country: "England" },
  season: "2026",
  status: "finished",
  homeTeam: { externalId: "api-football:1", name: "Home FC" },
  awayTeam: { externalId: "api-football:2", name: "Away FC" },
  homeScore: 2,
  awayScore: 1
};

function performance(overrides: Partial<PlayerMatchPerformance>): PlayerMatchPerformance {
  return {
    sport: "football",
    provider: "api_football",
    sourceKind: "real",
    fixtureExternalId: "api-football:prior",
    fixtureKickoffAt: "2026-07-01T18:00:00.000Z",
    teamExternalId: "api-football:1",
    playerExternalId: "api-football:player",
    playerName: "Test Player",
    position: "M",
    shirtNumber: 8,
    minutes: 90,
    started: true,
    captain: false,
    rating: 7,
    goals: 0,
    assists: 0,
    shotsTotal: 1,
    shotsOnTarget: 0,
    passesTotal: 30,
    keyPasses: 1,
    passAccuracy: 82,
    tackles: 2,
    interceptions: 1,
    saves: 0,
    yellowCards: 0,
    redCards: 0,
    dataQuality: 0.9,
    metrics: {},
    observedAt: "2026-07-02T00:00:00.000Z",
    ...overrides
  };
}

function completeFixturePlayerResponse() {
  return {
    response: [1, 2].map((teamId) => ({
      team: { id: teamId, name: teamId === 1 ? "Home FC" : "Away FC" },
      players: Array.from({ length: 11 }, (_, index) => ({
        player: { id: teamId * 100 + index, name: `Team ${teamId} Player ${index + 1}` },
        statistics: [{
          games: { minutes: 90, rating: "7.4", substitute: false },
          goals: { total: index === 0 ? 1 : 0 }
        }]
      }))
    }))
  };
}

describe("player performance corpus", () => {
  it("normalizes API-Football fixture player statistics into typed facts", () => {
    const rows = normalizeApiFootballPlayerPerformancesForFixture({
      response: [{
        team: { id: 1, name: "Home FC" },
        players: [{
          player: { id: 9, name: "Ada Striker" },
          statistics: [{
            games: { minutes: 88, number: 9, position: "F", rating: "7.8", captain: false, substitute: false },
            shots: { total: 4, on: 2 },
            goals: { total: 1, assists: 1, saves: 0 },
            passes: { total: 26, key: 3, accuracy: "84%" },
            tackles: { total: 1, interceptions: 2 },
            cards: { yellow: 1, red: 0 }
          }]
        }]
      }]
    }, fixture, { observedAt: "2026-07-15T00:00:00.000Z" });

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      fixtureExternalId: "api-football:101",
      teamExternalId: "api-football:1",
      playerExternalId: "api-football:9",
      playerName: "Ada Striker",
      minutes: 88,
      started: true,
      rating: 7.8,
      goals: 1,
      assists: 1,
      passAccuracy: 84
    });
  });

  it("builds player form from earlier kickoffs only and ignores same-match or future facts", () => {
    const rows: PlayerMatchPerformance[] = [];
    for (let match = 0; match < 5; match += 1) {
      for (let player = 0; player < 11; player += 1) {
        const kickoff = `2026-06-${String(10 + match).padStart(2, "0")}T18:00:00.000Z`;
        rows.push(performance({
          fixtureExternalId: `api-football:home-${match}`,
          fixtureKickoffAt: kickoff,
          playerExternalId: `api-football:home-player-${player}`,
          playerName: `Home Player ${player}`,
          rating: 7.5,
          goals: player === 0 ? 1 : 0
        }));
        rows.push(performance({
          fixtureExternalId: `api-football:away-${match}`,
          fixtureKickoffAt: kickoff,
          teamExternalId: "api-football:2",
          playerExternalId: `api-football:away-player-${player}`,
          playerName: `Away Player ${player}`,
          rating: 6.2
        }));
      }
    }
    const predictionFixture = {
      fixtureExternalId: "api-football:prediction",
      kickoffAt: "2026-07-14T18:00:00.000Z",
      homeTeam: { externalId: "api-football:1", name: "Home FC" },
      awayTeam: { externalId: "api-football:2", name: "Away FC" }
    };
    const baseline = buildPlayerFormSignal(predictionFixture, rows);
    const contaminated = buildPlayerFormSignal(predictionFixture, [
      ...rows,
      performance({ fixtureExternalId: "api-football:prediction", fixtureKickoffAt: predictionFixture.kickoffAt, rating: 0 }),
      performance({ fixtureExternalId: "api-football:future", fixtureKickoffAt: "2026-07-20T18:00:00.000Z", teamExternalId: "api-football:2", rating: 10 })
    ]);

    expect(baseline).not.toBeNull();
    expect(baseline?.quality).toBe("strong");
    expect(baseline?.weight).toBeGreaterThan(0);
    expect(baseline?.impact).toBe("home-positive");
    expect(contaminated).toEqual(baseline);
    expect(baseline?.detail).toContain("Only fixtures before this kickoff are included");
  });

  it("fetches the fixture player endpoint only when player-stat ingestion is explicitly requested", async () => {
    const calls: string[] = [];
    const result = await syncHistoricalFootballProvider({
      request: {
        provider: "api-football",
        league: "39",
        season: "2026",
        dryRun: true,
        includePlayerStats: true,
        maxContextFixtures: 1
      },
      env: { API_FOOTBALL_KEY: "test-key" },
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/fixtures/players")) {
          return new Response(JSON.stringify(completeFixturePlayerResponse()), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ response: [{
          fixture: { id: 101, date: fixture.kickoffAt, status: { short: "FT" } },
          league: { id: 39, name: "Premier League", country: "England", season: 2026 },
          teams: { home: { id: 1, name: "Home FC" }, away: { id: 2, name: "Away FC" } },
          goals: { home: 2, away: 1 }
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    expect(result.status).toBe("dry-run");
    expect(result.playerPerformancesFetched).toBe(22);
    expect(result.playerPerformancesNormalized).toBe(22);
    expect(result.playerPerformanceFixturesRequested).toBe(1);
    expect(result.playerPerformanceFixturesCovered).toBe(1);
    expect(result.playerPerformancesStored).toBe(0);
    expect(result.playerPerformancesVerified).toBe(0);
    expect(calls.filter((url) => url.includes("/fixtures/players"))).toHaveLength(1);
  });

  it("rejects a finished-fixture backfill when player rows are missing or incomplete", async () => {
    const result = await syncHistoricalFootballProvider({
      request: {
        provider: "api-football",
        league: "39",
        season: "2026",
        dryRun: true,
        includePlayerStats: true,
        maxContextFixtures: 1
      },
      env: { API_FOOTBALL_KEY: "test-key" },
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("/fixtures/players")) {
          return new Response(JSON.stringify({ response: [] }), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ response: [{
          fixture: { id: 101, date: fixture.kickoffAt, status: { short: "FT" } },
          league: { id: 39, name: "Premier League", country: "England", season: 2026 },
          teams: { home: { id: 1, name: "Home FC" }, away: { id: 2, name: "Away FC" } },
          goals: { home: 2, away: 1 }
        }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
    });

    expect(result.status).toBe("invalid-response");
    expect(result.playerPerformanceFixturesRequested).toBe(1);
    expect(result.playerPerformanceFixturesCovered).toBe(0);
    expect(result.playerPerformancesStored).toBe(0);
    expect(result.playerPerformancesErrors?.[0]).toContain("at least 11 per team are required");
  });
});
