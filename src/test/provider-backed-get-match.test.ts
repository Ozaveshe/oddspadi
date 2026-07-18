import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import type { SportsDataProvider } from "@/lib/sports/types";

function fallbackThatMustNotHandleProviderIds(): SportsDataProvider {
  return {
    getFixtures: vi.fn(async () => []),
    getMatch: vi.fn(async () => {
      throw new Error("provider IDs must not delegate to the mock fallback");
    }),
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

const basketballGame = {
  id: 501,
  date: "2026-07-10T19:30:00Z",
  status: { short: "NS" },
  league: { id: 12, name: "NBA", country: "USA", season: "2026" },
  teams: { home: { id: 1, name: "Boston Celtics" }, away: { id: 2, name: "Miami Heat" } },
  scores: { home: { total: null }, away: { total: null } }
};

const tennisEvent = {
  event_key: 701,
  event_date: "2026-07-10",
  event_time: "13:00",
  event_status: "Not Started",
  event_first_player: "Carlos Alcaraz",
  event_second_player: "Daniil Medvedev",
  first_player_key: 1,
  second_player_key: 2,
  tournament_key: 444,
  tournament_name: "ATP Hard Court",
  surface: "Hard"
};

const oddsTennisEvent = {
  id: "odds-event-701",
  sport_key: "tennis_atp_wimbledon",
  sport_title: "ATP Tennis",
  commence_time: "2026-07-10T13:00:00Z",
  home_team: "Carlos Alcaraz",
  away_team: "Daniil Medvedev",
  bookmakers: [
    {
      title: "Test Book",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Carlos Alcaraz", price: 1.68 },
            { name: "Daniil Medvedev", price: 2.22 }
          ]
        }
      ]
    }
  ]
};

describe("provider-backed match detail retrieval", () => {
  it("loads and caches api-basketball game IDs without using the fallback", async () => {
    const calls: string[] = [];
    const fallback = fallbackThatMustNotHandleProviderIds();
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_BASKETBALL_KEY: "basketball-key" },
      fallback,
      historicalBasketballStrengthLoader: async () => new Map(),
      fetchImpl: async (input) => {
        const url = input.toString();
        calls.push(url);
        return new Response(JSON.stringify({ response: [basketballGame] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    const first = await provider.getMatch("api-basketball:501");
    const second = await provider.getMatch("api-basketball:501");

    expect(first?.id).toBe("api-basketball:501");
    expect(first?.dataSource?.fixtureProvider).toBe("api-basketball");
    expect(second).toBe(first);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("games?id=501");
    expect(calls[1]).toContain("games?date=2026-07-10");
    expect(fallback.getMatch).not.toHaveBeenCalled();
  });

  it("loads and caches api-tennis event IDs without using the fallback", async () => {
    const calls: string[] = [];
    const fallback = fallbackThatMustNotHandleProviderIds();
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_TENNIS_KEY: "tennis-key" },
      fallback,
      historicalTennisStrengthLoader: async () => new Map(),
      fetchImpl: async (input) => {
        const url = input.toString();
        calls.push(url);
        return new Response(JSON.stringify({ result: [tennisEvent] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    const first = await provider.getMatch("api-tennis:701");
    const second = await provider.getMatch("api-tennis:701");

    expect(first?.id).toBe("api-tennis:701");
    expect(first?.dataSource?.fixtureProvider).toBe("api-tennis");
    expect(second).toBe(first);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("event_key=701");
    expect(calls[1]).toContain("date_start=2026-07-10");
    expect(fallback.getMatch).not.toHaveBeenCalled();
  });

  it("uses one exact sport-key event lookup and caches the successful result", async () => {
    const calls: string[] = [];
    const fallback = fallbackThatMustNotHandleProviderIds();
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        THE_ODDS_API_KEY: "odds-key",
      },
      fallback,
      historicalTennisStrengthLoader: async () => new Map(),
      fetchImpl: async (input) => {
        const url = input.toString();
        calls.push(url);
        return Response.json(oddsTennisEvent);
      }
    });

    const qualifiedId = "the-odds-api:tennis_atp_wimbledon:odds-event-701";
    const first = await provider.getMatch(qualifiedId);
    const second = await provider.getMatch(qualifiedId);

    expect(first?.id).toBe("the-odds-api:odds-event-701");
    expect(first?.sport).toBe("tennis");
    expect(first?.dataSource?.fixtureProvider).toBe("the-odds-api-events");
    expect(first?.oddsMarkets[0]?.id).toBe("match_winner");
    expect(second).toBe(first);
    expect(calls.map((url) => new URL(url).pathname)).toEqual([
      "/v4/sports/tennis_atp_wimbledon/events/odds-event-701/odds"
    ]);
    expect(new URL(calls[0]).searchParams.get("regions")).toBe("uk");
    expect(fallback.getMatch).not.toHaveBeenCalled();
  });

  it("negative-caches one exact event miss instead of repeating a paid probe", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      calls.push(String(input));
      return new Response("not found", { status: 404 });
    });
    const fallback = fallbackThatMustNotHandleProviderIds();
    const provider = new ProviderBackedSportsDataProvider({
      env: { THE_ODDS_API_KEY: "odds-key" },
      fallback,
      fetchImpl
    });
    const qualifiedId = "the-odds-api:basketball_wnba:missing-event";

    await expect(provider.getMatch(qualifiedId)).resolves.toBeNull();
    await expect(provider.getMatch(qualifiedId)).resolves.toBeNull();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(new URL(calls[0]).pathname).toBe(
      "/v4/sports/basketball_wnba/events/missing-event/odds"
    );
    expect(fallback.getMatch).not.toHaveBeenCalled();
  });

  it("fails closed for an opaque unknown event ID without any paid cross-sport probes", async () => {
    const fetchImpl = vi.fn(async () => Response.json([]));
    const fallback = fallbackThatMustNotHandleProviderIds();
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_FOOTBALL_SPORT_KEY: "soccer_epl",
        ODDS_API_BASKETBALL_SPORT_KEY: "basketball_wnba",
        ODDS_API_TENNIS_SPORT_KEY: "tennis_atp_wimbledon"
      },
      fallback,
      fetchImpl
    });

    await expect(provider.getMatch("the-odds-api:opaque-unknown")).resolves.toBeNull();
    await expect(provider.getMatch("the-odds-api:opaque-unknown")).resolves.toBeNull();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(fallback.getMatch).not.toHaveBeenCalled();
  });

  it.each(["api-basketball:501", "api-tennis:701", "the-odds-api:odds-event-701"])(
    "returns null for an unconfigured %s ID instead of delegating to fallback",
    async (matchId) => {
      const fallback = fallbackThatMustNotHandleProviderIds();
      const provider = new ProviderBackedSportsDataProvider({ env: {}, fallback });

      await expect(provider.getMatch(matchId)).resolves.toBeNull();
      expect(fallback.getMatch).not.toHaveBeenCalled();
    }
  );
});
