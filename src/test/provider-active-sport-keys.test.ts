import { describe, expect, it } from "vitest";
import { ProviderBackedSportsDataProvider, getRecentSportsProviderIssues } from "@/lib/sports/providers/providerBackedProvider";

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" }
  });
}

describe("The Odds API active sport discovery", () => {
  it("discovers active basketball competitions when the NBA is out of season", async () => {
    const calls: string[] = [];
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        NODE_ENV: "production",
        THE_ODDS_API_KEY: "odds-key"
      },
      now: () => new Date("2026-07-18T08:00:00.000Z"),
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/v4/sports/?")) {
          return jsonResponse([
            { key: "basketball_nba", group: "Basketball", title: "NBA", active: false, has_outrights: false },
            { key: "basketball_nba_summer_league", group: "Basketball", title: "NBA Summer League", active: true, has_outrights: false },
            { key: "basketball_wnba", group: "Basketball", title: "WNBA", active: true, has_outrights: false },
            { key: "basketball_nba_championship_winner", group: "Basketball", title: "NBA Winner", active: true, has_outrights: true }
          ]);
        }
        if (url.includes("/sports/basketball_nba_summer_league/odds/")) {
          return jsonResponse([
            {
              id: "summer-league-1",
              sport_key: "basketball_nba_summer_league",
              sport_title: "NBA Summer League",
              commence_time: "2026-07-18T18:00:00.000Z",
              home_team: "Chicago Bulls",
              away_team: "Milwaukee Bucks",
              bookmakers: [
                {
                  key: "draftkings",
                  title: "DraftKings",
                  markets: [{ key: "h2h", outcomes: [{ name: "Chicago Bulls", price: 1.8 }, { name: "Milwaukee Bucks", price: 2.05 }] }]
                }
              ]
            }
          ]);
        }
        if (url.includes("/sports/basketball_wnba/odds/") || url.includes("/scores/")) return jsonResponse([]);
        return jsonResponse([], 404);
      },
      historicalBasketballStrengthLoader: async () => new Map()
    });

    const fixtures = await provider.getFixtures("2026-07-18", "basketball");

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]?.id).toBe("the-odds-api:summer-league-1");
    expect(fixtures[0]?.oddsMarkets[0]?.selections).toHaveLength(2);
    expect(calls.some((url) => url.includes("/sports/basketball_nba_summer_league/odds/"))).toBe(true);
    expect(calls.some((url) => url.includes("/sports/basketball_wnba/odds/"))).toBe(true);
    expect(calls.some((url) => url.includes("/sports/basketball_nba/odds/"))).toBe(false);
    expect(calls.some((url) => url.includes("basketball_nba_championship_winner"))).toBe(false);
  });

  it("discovers tournament-scoped tennis keys instead of calling the invalid tennis_atp key", async () => {
    const calls: string[] = [];
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        NODE_ENV: "production",
        THE_ODDS_API_KEY: "odds-key",
        // A legacy production value must not override active-key discovery.
        ODDS_API_TENNIS_SPORT_KEY: "tennis_atp"
      },
      now: () => new Date("2026-07-14T08:00:00.000Z"),
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("/v4/sports/?")) {
          return jsonResponse([
            { key: "tennis_atp_canadian_open", group: "Tennis", title: "ATP Canadian Open", active: true, has_outrights: false },
            { key: "tennis_atp", group: "Tennis", title: "Invalid generic key", active: false, has_outrights: false },
            { key: "soccer_epl", group: "Soccer", title: "EPL", active: false, has_outrights: false }
          ]);
        }
        if (url.includes("/sports/tennis_atp_canadian_open/odds/")) {
          return jsonResponse([
            {
              id: "active-tennis-1",
              sport_key: "tennis_atp_canadian_open",
              sport_title: "ATP Canadian Open",
              commence_time: "2026-07-14T15:00:00.000Z",
              home_team: "Player One",
              away_team: "Player Two",
              bookmakers: [
                {
                  key: "paddy_power",
                  title: "Paddy Power",
                  markets: [{ key: "h2h", outcomes: [{ name: "Player One", price: 1.8 }, { name: "Player Two", price: 2.1 }] }]
                }
              ]
            }
          ]);
        }
        if (url.includes("/sports/tennis_atp_canadian_open/scores/")) return jsonResponse([]);
        return jsonResponse([], 404);
      }
    });

    const fixtures = await provider.getFixtures("2026-07-14", "tennis");

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]?.id).toBe("the-odds-api:active-tennis-1");
    expect(fixtures[0]?.oddsMarkets[0]?.selections).toHaveLength(2);
    expect(calls.some((url) => url.includes("/v4/sports/?"))).toBe(true);
    expect(calls.some((url) => url.includes("/sports/tennis_atp_canadian_open/odds/"))).toBe(true);
    expect(calls.some((url) => url.includes("/sports/tennis_atp/"))).toBe(false);
    expect(getRecentSportsProviderIssues("2026-07-14T08:00:00.000Z").some((issue) => issue.path.includes("tennis_atp/"))).toBe(false);
  });
});
