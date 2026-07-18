import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";

describe("The Odds API completed score bridge", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ["basketball", "basketball_nba_summer_league", "Miami Heat", "Milwaukee Bucks", 91, 84],
    ["tennis", "tennis_atp_wimbledon", "Jannik Sinner", "Novak Djokovic", 3, 1]
  ] as const)("settles a finished %s fixture by its exact persisted key after live odds disappear", async (sport, sportKey, home, away, homeScore, awayScore) => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v4/sports/") {
        return Response.json([{ key: sportKey, active: true, has_outrights: false }]);
      }
      if (url.pathname === `/v4/sports/${sportKey}/events/`) return Response.json([]);
      if (url.pathname.endsWith("/odds/")) return Response.json([]);
      expect(url.pathname).toBe(`/v4/sports/${sportKey}/scores/`);
      expect(url.searchParams.get("daysFrom")).toBe("3");
      return Response.json([
        {
          id: "score-event-1",
          sport_key: sportKey,
          sport_title: sport === "basketball" ? "NBA Summer League" : "ATP Wimbledon",
          commence_time: "2026-07-10T02:00:00Z",
          completed: true,
          home_team: home,
          away_team: away,
          scores: [
            { name: home, score: String(homeScore) },
            { name: away, score: String(awayScore) }
          ]
        }
      ]);
    });
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        NODE_ENV: "production",
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_BASKETBALL_SPORT_KEYS: "basketball_nba_summer_league",
        ODDS_API_TENNIS_SPORT_KEYS: "tennis_atp_wimbledon"
      },
      fetchImpl,
      historicalBasketballStrengthLoader: async () => new Map(),
      historicalTennisStrengthLoader: async () => new Map()
    });

    const fixtures = await provider.getSettlementFixtures("2026-07-10", sport, [sportKey]);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      id: "the-odds-api:score-event-1",
      sport,
      status: "finished",
      score: { home: homeScore, away: awayScore },
      dataSource: { kind: "provider", fixtureProvider: "the-odds-api-scores", fixtureProviderId: "score-event-1" }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("uses a ticket's exact tournament key even after active-key discovery loses it", async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      if (url.pathname === "/v4/sports/") {
        return Response.json([{ key: "tennis_atp_us_open", active: true, has_outrights: false }]);
      }
      if (url.pathname === "/v4/sports/tennis_atp_us_open/events/") return Response.json([]);
      if (url.pathname.endsWith("/odds/")) return Response.json([]);
      if (url.pathname === "/v4/sports/tennis_atp_us_open/scores/") return Response.json([]);
      expect(url.pathname).toBe("/v4/sports/tennis_atp_wimbledon/scores/");
      return Response.json([{
        id: "wimbledon-final",
        sport_key: "tennis_atp_wimbledon",
        sport_title: "ATP Wimbledon",
        commence_time: "2026-07-12T09:00:00Z",
        completed: true,
        home_team: "Jannik Sinner",
        away_team: "Alexander Zverev",
        scores: [
          { name: "Jannik Sinner", score: "3" },
          { name: "Alexander Zverev", score: "1" }
        ]
      }]);
    });
    const provider = new ProviderBackedSportsDataProvider({
      env: { NODE_ENV: "production", THE_ODDS_API_KEY: "odds-key" },
      fetchImpl,
      historicalTennisStrengthLoader: async () => new Map()
    });

    const fixtures = await provider.getSettlementFixtures(
      "2026-07-12",
      "tennis",
      ["tennis_atp_wimbledon"]
    );

    expect(fixtures).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "the-odds-api:wimbledon-final",
        status: "finished",
        score: { home: 3, away: 1 }
      })
    ]));
  });
});
