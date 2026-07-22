import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";

const basketballEvent = {
  id: "summer-501",
  sport_key: "basketball_nba_summer_league",
  sport_title: "NBA Summer League",
  commence_time: "2026-07-14T19:30:00Z",
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
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses The Odds API as a real basketball fixture source without an API-Basketball key", async () => {
    vi.setSystemTime(new Date("2026-07-14T12:00:00Z"));
    const calls: string[] = [];
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_BASKETBALL_SPORT_KEY: "basketball_nba_summer_league",
        ODDS_API_CORE_MARKETS: "h2h,spreads,totals"
      },
      fetchImpl: async (input) => {
        const url = input.toString();
        calls.push(url);
        if (new URL(url).pathname === "/v4/sports/") {
          return Response.json([
            { key: "basketball_nba_summer_league", active: true, has_outrights: false }
          ]);
        }
        const isEventsRequest = url.includes("/v4/sports/basketball_nba_summer_league/events/");
        const isOddsRequest = url.includes("/v4/sports/basketball_nba_summer_league/odds/");
        const isScoresRequest = url.includes("/v4/sports/basketball_nba_summer_league/scores/");
        expect(isEventsRequest || isOddsRequest || isScoresRequest).toBe(true);
        if (isEventsRequest) {
          expect(new URL(url).searchParams.get("commenceTimeFrom")).toBe("2026-07-14T00:00:00Z");
          return Response.json([basketballEvent]);
        }
        if (isOddsRequest) {
          expect(url).toContain("markets=h2h%2Cspreads%2Ctotals");
          expect(new URL(url).searchParams.get("regions")).toBe("us");
        }
        return new Response(JSON.stringify(isOddsRequest ? [basketballEvent] : []), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
    });

    const [match] = await provider.getFixtures("2026-07-14", "basketball");

    expect(calls).toHaveLength(3);
    expect(calls.filter((url) => new URL(url).pathname === "/v4/sports/")).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/events/"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/odds/"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/scores/"))).toHaveLength(0);
    expect(match.id).toBe("the-odds-api:summer-501");
    expect(match.sport).toBe("basketball");
    expect(match.league.name).toBe("NBA Summer League");
    expect(match.dataSource?.kind).toBe("provider");
    expect(match.dataSource?.fixtureProvider).toBe("the-odds-api-events");
    expect(match.dataSource?.oddsProvider).toBe("the-odds-api");
    expect(match.oddsMarkets.map((market) => market.id)).toEqual(["match_winner", "spread", "total_points"]);
  });

  it("caches a successful empty date catalogue without paid odds or arbitrary score reads", async () => {
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

    expect(first).toEqual([]);
    expect(second).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls.filter((url) => new URL(url).pathname === "/v4/sports/")).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/v4/sports/basketball_nba/events/"))).toHaveLength(1);
    expect(calls.filter((url) => url.includes("/v4/sports/basketball_nba/odds/"))).toHaveLength(0);
    expect(calls.filter((url) => url.includes("/v4/sports/basketball_nba/scores/"))).toHaveLength(0);
    expect(calls.some((url) => url.includes("/v4/historical/"))).toBe(false);
  });

  it("reuses one raw current odds feed and partitions it across three date reads", async () => {
    const calls: string[] = [];
    const events = ["2026-07-14", "2026-07-15", "2026-07-16"].map((date, index) => ({
      ...basketballEvent,
      id: `summer-${index + 1}`,
      commence_time: `${date}T19:30:00Z`
    }));
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        NODE_ENV: "production",
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_BASKETBALL_SPORT_KEY: "basketball_nba_summer_league"
      },
      historicalBasketballStrengthLoader: async () => new Map(),
      fetchImpl: async (input) => {
        const url = input.toString();
        calls.push(url);
        const pathname = new URL(url).pathname;
        if (pathname === "/v4/sports/") {
          return Response.json([
            { key: "basketball_nba_summer_league", active: true, has_outrights: false }
          ]);
        }
        if (pathname === "/v4/sports/basketball_nba_summer_league/events/") {
          const targetDate = new URL(url).searchParams.get("commenceTimeFrom")?.slice(0, 10);
          return Response.json(events.filter((event) => event.commence_time.startsWith(targetDate ?? "")));
        }
        if (pathname === "/v4/sports/basketball_nba_summer_league/odds/") return Response.json(events);
        return new Response("unexpected provider request", { status: 500 });
      }
    });

    const dates = ["2026-07-14", "2026-07-15", "2026-07-16"];
    const fixtures = await Promise.all(dates.map((date) => provider.getFixtures(date, "basketball")));

    expect(fixtures.map((rows) => rows.map((row) => row.kickoffTime.slice(0, 10)))).toEqual(dates.map((date) => [date]));
    expect(calls.filter((url) => new URL(url).pathname === "/v4/sports/")).toHaveLength(1);
    expect(calls.filter((url) => new URL(url).pathname.endsWith("/events/"))).toHaveLength(3);
    expect(calls.filter((url) => new URL(url).pathname.endsWith("/odds/"))).toHaveLength(1);
    expect(calls.some((url) => new URL(url).pathname.endsWith("/scores/"))).toBe(false);
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
