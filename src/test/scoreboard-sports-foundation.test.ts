import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import { modelHandballMatch, modelIceHockeyMatch } from "@/lib/sports/prediction/highScoringPoissonModel";
import { gradeMarketDecision } from "@/lib/sports/results/marketDecisionSettlement";
import type { Match } from "@/lib/sports/types";

/**
 * Foundation for the two v4 sports: fixtures and scores flow, models emit
 * coherent probabilities, settlement can grade the results — while activation
 * (catalogue `active`, decision-model registry) deliberately stays off until
 * the v4 evidence gates are met. Both providers run free plans capped at 100
 * requests/day, so the adapter's own six-hour cache is part of the contract,
 * not an optimisation.
 */
function scoreboardPayload(sport: "handball" | "hockey") {
  return Response.json({
    response: [
      {
        id: 991,
        date: "2026-08-21T17:00:00+00:00",
        timestamp: 1787245200,
        status: { short: "NS", long: "Not Started" },
        country: { name: "Germany" },
        league: { id: 39, name: sport === "handball" ? "Bundesliga HBL" : "DEL", season: 2026 },
        teams: { home: { id: 1, name: "THW Kiel" }, away: { id: 2, name: "SC Magdeburg" } },
        scores: { home: null, away: null }
      },
      {
        id: 992,
        date: "2026-08-21T14:00:00+00:00",
        timestamp: 1787234400,
        status: { short: "FT", long: "Game Finished" },
        country: { name: "Germany" },
        league: { id: 39, name: sport === "handball" ? "Bundesliga HBL" : "DEL", season: 2026 },
        teams: { home: { id: 3, name: "Flensburg" }, away: { id: 4, name: "Berlin" } },
        scores: sport === "handball" ? { home: 31, away: 27 } : { home: 4, away: 2 }
      }
    ]
  });
}

describe("scoreboard sport adapters", () => {
  it("maps handball fixtures, scores and statuses from API-Sports", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      expect(url.hostname).toBe("v1.handball.api-sports.io");
      return scoreboardPayload("handball");
    });
    const provider = new ProviderBackedSportsDataProvider({
      env: { NODE_ENV: "production", API_HANDBALL_KEY: "hb-key" },
      fetchImpl
    });

    const matches = await provider.getFixtures("2026-08-21", "handball");
    expect(matches).toHaveLength(2);
    expect(matches[0]).toMatchObject({
      id: "api-handball:991",
      sport: "handball",
      status: "scheduled",
      dataSource: { fixtureProvider: "api-handball" }
    });
    expect(matches[0].score).toBeUndefined();
    expect(matches[1]).toMatchObject({ status: "finished", score: { home: 31, away: 27 } });

    // The quota contract: a second read of the same day is served from the
    // adapter's own cache, not a second upstream request.
    await provider.getFixtures("2026-08-21", "handball");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("maps ice hockey fixtures from API-Sports", async () => {
    const fetchImpl = vi.fn(async () => scoreboardPayload("hockey"));
    const provider = new ProviderBackedSportsDataProvider({
      env: { NODE_ENV: "production", API_HOCKEY_KEY: "ih-key" },
      fetchImpl
    });

    const matches = await provider.getFixtures("2026-08-21", "ice_hockey");
    expect(matches).toHaveLength(2);
    expect(matches[0].id).toBe("api-hockey:991");
    expect(matches[0].sport).toBe("ice_hockey");
    expect(matches[1].score).toEqual({ home: 4, away: 2 });
    expect(matches[0].dataSource?.notes?.join(" ")).toContain("nothing publishes");
  });
});

function foundationMatch(sport: Match["sport"]): Match {
  return {
    id: `${sport}-model-test`,
    sport,
    league: { id: "league-1", name: "Test League", country: "World", strength: 0.7 },
    kickoffTime: "2026-08-21T17:00:00.000Z",
    homeTeam: { id: "home-1", name: "Home", rating: 80 },
    awayTeam: { id: "away-1", name: "Away", rating: 72 },
    status: "scheduled",
    oddsMarkets: [],
    homeForm: { teamId: "home-1", recentResults: [], goalsFor: 0, goalsAgainst: 0, attackStrength: 0.5, defenseStrength: 0.5 },
    awayForm: { teamId: "away-1", recentResults: [], goalsFor: 0, goalsAgainst: 0, attackStrength: 0.5, defenseStrength: 0.5 },
    dataQualityScore: 0.6
  };
}

describe("high-scoring poisson models", () => {
  it("prices handball as a true three-way with monotone totals", () => {
    const { markets } = modelHandballMatch(foundationMatch("handball"));
    const byId = new Map(markets.map((market) => [market.marketId as string, market.probabilities]));
    const winner = byId.get("match_winner")!;
    expect(Math.abs(winner.home + winner.draw + winner.away - 1)).toBeLessThan(0.001);
    // The stronger side must be favored, and the draw must be a real but
    // minority outcome at handball scoring levels.
    expect(winner.home).toBeGreaterThan(winner.away);
    expect(winner.draw).toBeGreaterThan(0.01);
    expect(winner.draw).toBeLessThan(0.2);
    expect(byId.get("over_under_505")!.over_505).toBeGreaterThanOrEqual(byId.get("over_under_545")!.over_545);
    expect(byId.get("over_under_545")!.over_545).toBeGreaterThanOrEqual(byId.get("over_under_585")!.over_585);
  });

  it("prices hockey as two-way because overtime forbids drawn finals", () => {
    const { markets } = modelIceHockeyMatch(foundationMatch("ice_hockey"));
    const byId = new Map(markets.map((market) => [market.marketId as string, market.probabilities]));
    const winner = byId.get("match_winner")!;
    expect(winner.draw).toBeUndefined();
    expect(Math.abs(winner.home + winner.away - 1)).toBeLessThan(0.001);
    expect(winner.home).toBeGreaterThan(winner.away);
    expect(byId.get("over_under_55")!.over_55).toBeGreaterThanOrEqual(byId.get("over_under_65")!.over_65);
  });

  it("settles the new totals lines from final scores", () => {
    const finished = (home: number, away: number) => ({ status: "finished" as const, homeScore: home, awayScore: away });
    expect(gradeMarketDecision({ market: "over_under_545", selection: "over_545", fixture: finished(31, 27) }).result).toBe("won");
    expect(gradeMarketDecision({ market: "over_under_545", selection: "under_545", fixture: finished(26, 25) }).result).toBe("won");
    expect(gradeMarketDecision({ market: "over_under_55", selection: "over_55", fixture: finished(4, 2) }).result).toBe("won");
    expect(gradeMarketDecision({ market: "over_under_65", selection: "over_65", fixture: finished(4, 2) }).result).toBe("lost");
  });
});
