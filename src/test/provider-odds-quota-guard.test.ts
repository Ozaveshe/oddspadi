import { describe, expect, it } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";

const basketballEvent = {
  id: "summer-501",
  sport_key: "basketball_nba_summer_league",
  sport_title: "NBA Summer League",
  commence_time: "2026-07-10T19:30:00Z",
  home_team: "Boston Celtics Summer League",
  away_team: "Miami Heat Summer League",
  bookmakers: [
    {
      title: "Test Book",
      markets: [
        {
          key: "h2h",
          outcomes: [
            { name: "Boston Celtics Summer League", price: 1.68 },
            { name: "Miami Heat Summer League", price: 2.2 }
          ]
        },
        {
          key: "spreads",
          outcomes: [
            { name: "Boston Celtics Summer League", price: 1.91, point: -3.5 },
            { name: "Miami Heat Summer League", price: 1.91, point: 3.5 }
          ]
        },
        {
          key: "totals",
          outcomes: [
            { name: "Over", price: 1.9, point: 171.5 },
            { name: "Under", price: 1.9, point: 171.5 }
          ]
        }
      ]
    }
  ]
};

describe("provider odds quota guard", () => {
  it("uses The Odds API as a real basketball fixture source without an API-Basketball key", async () => {
    const calls: string[] = [];
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_BASKETBALL_SPORT_KEY: "basketball_nba_summer_league"
      },
      fetchImpl: async (input) => {
        const url = input.toString();
        calls.push(url);
        const isOddsRequest = url.includes("/v4/sports/basketball_nba_summer_league/odds/");
        const isScoresRequest = url.includes("/v4/sports/basketball_nba_summer_league/scores/");
        expect(isOddsRequest || isScoresRequest).toBe(true);
        if (isOddsRequest) {
          expect(url).toContain("markets=h2h%2Cspreads%2Ctotals");
        }
        return new Response(JSON.stringify(isOddsRequest ? [basketballEvent] : []), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    const [match] = await provider.getFixtures("2026-07-10", "basketball");

    expect(calls).toHaveLength(2);
    expect(calls.filter((url) => url.includes("/odds/"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/scores/"))).toHaveLength(1);
    expect(match.id).toBe("the-odds-api:summer-501");
    expect(match.sport).toBe("basketball");
    expect(match.league.name).toBe("NBA Summer League");
    expect(match.dataSource?.kind).toBe("provider");
    expect(match.dataSource?.fixtureProvider).toBe("the-odds-api-events");
    expect(match.dataSource?.oddsProvider).toBe("the-odds-api");
    expect(match.oddsMarkets.map((market) => market.id)).toEqual(["match_winner", "spread", "total_points"]);
  });

  it("caches current snapshots and does not fall into historical billing by default", async () => {
    const calls: string[] = [];
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_BASKETBALL_SPORT_KEY: "basketball_nba"
      },
      fetchImpl: async (input) => {
        const url = input.toString();
        calls.push(url);
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    const first = await provider.getFixtures("2026-07-10", "basketball");
    const second = await provider.getFixtures("2026-07-10", "basketball");

    expect(first[0]?.dataSource?.kind).toBe("mock");
    expect(second[0]?.dataSource?.kind).toBe("mock");
    expect(calls).toHaveLength(2);
    expect(calls.filter((url) => url.includes("/v4/sports/basketball_nba/odds/"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/v4/sports/basketball_nba/scores/"))).toHaveLength(1);
    expect(calls.some((url) => url.includes("/v4/historical/"))).toBe(false);
  });

  it("deduplicates football fixture reads and skips far-future context calls", async () => {
    const calls: string[] = [];
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_FOOTBALL_KEY: "football-key" },
      fetchImpl: async (input) => {
        const url = input.toString();
        calls.push(url);
        if (url.includes("/standings")) {
          return new Response(JSON.stringify({ response: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/fixtures?") && url.includes("team=")) {
          return new Response(JSON.stringify({ response: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
        }
        if (url.includes("/fixtures")) {
          return new Response(
            JSON.stringify({
              response: [
                {
                  fixture: { id: 9001, date: "2030-08-21T19:00:00Z", status: { short: "NS" } },
                  league: { id: 39, name: "Premier League", country: "England", season: 2030 },
                  teams: { home: { id: 1, name: "Arsenal" }, away: { id: 2, name: "Coventry City" } },
                  goals: { home: null, away: null }
                }
              ]
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          );
        }
        return new Response("unexpected", { status: 500 });
      }
    });

    const first = await provider.getFixtures("2030-08-21", "football");
    const callsAfterFirstRead = calls.length;
    const second = await provider.getFixtures("2030-08-21", "football");

    expect(first[0]?.id).toBe("api-football:9001");
    expect(second[0]?.id).toBe("api-football:9001");
    expect(calls.length).toBe(callsAfterFirstRead);
    expect(calls.filter((url) => url.includes("football.api-sports.io/fixtures?") && url.includes("date="))).toHaveLength(1);
    expect(calls.some((url) => url.includes("/fixtures/lineups"))).toBe(false);
    expect(calls.some((url) => url.includes("/injuries"))).toBe(false);
    expect(calls.some((url) => url.includes("/fixtures/events"))).toBe(false);
  });
});
