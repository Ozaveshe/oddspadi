import { describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";

describe("API-Tennis bookmaker odds", () => {
  it("prices API-Tennis fixtures without spending The Odds API quota", async () => {
    const calls: URL[] = [];
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url);
      expect(url.hostname).toBe("api.api-tennis.com");
      if (url.searchParams.get("method") === "get_fixtures") {
        return Response.json({
          success: 1,
          result: [{
            event_key: "701",
            event_date: "2026-07-22",
            event_time: "14:30",
            event_status: "Scheduled",
            event_first_player: "Player One",
            event_second_player: "Player Two",
            first_player_key: "1",
            second_player_key: "2",
            tournament_key: "44",
            tournament_name: "ATP Test"
          }]
        });
      }
      expect(url.searchParams.get("method")).toBe("get_odds");
      return Response.json({
        success: 1,
        result: {
          "701": {
            "Home/Away": {
              Home: { bet365: "1.80", bwin: "1.85" },
              Away: { bet365: "2.05", bwin: "2.00" }
            }
          }
        }
      });
    });
    const provider = new ProviderBackedSportsDataProvider({
      env: { NODE_ENV: "production", API_TENNIS_KEY: "tennis-key", THE_ODDS_API_KEY: "odds-key" },
      fetchImpl,
      historicalTennisStrengthLoader: async () => new Map()
    });

    const [match] = await provider.getFixtures("2026-07-22", "tennis");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(calls.map((url) => url.searchParams.get("method")).sort()).toEqual(["get_fixtures", "get_odds"]);
    expect(match).toMatchObject({
      id: "api-tennis:701",
      sport: "tennis",
      dataSource: {
        fixtureProvider: "api-tennis",
        oddsProvider: "api-tennis-odds",
        oddsProviderEventId: "701"
      }
    });
    expect(match.oddsMarkets).toEqual([
      expect.objectContaining({
        id: "match_winner",
        consensus: expect.objectContaining({ bookmakerCount: 2 })
      })
    ]);
  });
});
