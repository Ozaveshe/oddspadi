import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";

describe("The Odds API completed score bridge", () => {
  it.each([
    ["basketball", "basketball_nba_summer_league", "Miami Heat", "Milwaukee Bucks", 91, 84],
    ["tennis", "tennis_atp_wimbledon", "Jannik Sinner", "Novak Djokovic", 3, 1]
  ] as const)("returns a finished %s fixture after live odds disappear", async (sport, sportKey, home, away, homeScore, awayScore) => {
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
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
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_BASKETBALL_SPORT_KEYS: "basketball_nba_summer_league",
        ODDS_API_TENNIS_SPORT_KEYS: "tennis_atp_wimbledon"
      },
      fetchImpl,
      historicalBasketballStrengthLoader: async () => new Map(),
      historicalTennisStrengthLoader: async () => new Map()
    });

    const fixtures = await provider.getFixtures("2026-07-10", sport);
    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      id: "the-odds-api:score-event-1",
      sport,
      status: "finished",
      score: { home: homeScore, away: awayScore },
      dataSource: { kind: "provider", fixtureProvider: "the-odds-api-scores", fixtureProviderId: "score-event-1" }
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
