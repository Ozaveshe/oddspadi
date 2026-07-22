import { describe, expect, it } from "vitest";
import { apiFootballOddsCoverageFailed, ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";

function json(body: unknown, headers: Record<string, string> = {}) {
  return Response.json(body, {
    headers: {
      "x-ratelimit-requests-limit": "75000",
      "x-ratelimit-requests-remaining": "69000",
      "x-ratelimit-limit": "450",
      "x-ratelimit-remaining": "449",
      ...headers
    }
  });
}

function fixture(id: number, leagueId: number, home: string, away: string, kickoff: string) {
  return {
    fixture: { id, date: kickoff, status: { short: "NS" } },
    league: { id: leagueId, name: leagueId === 39 ? "Premier League" : "Verified Odds League", country: "World", season: 2026 },
    teams: { home: { id: id * 2, name: home }, away: { id: id * 2 + 1, name: away } },
    goals: { home: null, away: null }
  };
}

function apiFootballOddsRow(id: number, update: string, home = 2.25, draw = 3.35, away = 3.15) {
  return {
    fixture: { id },
    update,
    bookmakers: [
      {
        id: 6,
        name: "API Book One",
        bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: String(home) }, { value: "Draw", odd: String(draw) }, { value: "Away", odd: String(away) }] }]
      },
      {
        id: 8,
        name: "API Book Two",
        bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: String(home + 0.05) }, { value: "Draw", odd: String(draw - 0.05) }, { value: "Away", odd: String(away + 0.05) }] }]
      },
      {
        id: 11,
        name: "API Book Three",
        bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: String(home - 0.05) }, { value: "Draw", odd: String(draw + 0.05) }, { value: "Away", odd: String(away - 0.05) }] }]
      }
    ]
  };
}

describe("API-Football exact-ID odds fallback", () => {
  it("does not classify an intentional page ceiling as a provider failure", () => {
    expect(apiFootballOddsCoverageFailed({ pagesFailed: 0, stoppedByQuota: false })).toBe(false);
    expect(apiFootballOddsCoverageFailed({ pagesFailed: 1, stoppedByQuota: false })).toBe(true);
    expect(apiFootballOddsCoverageFailed({ pagesFailed: 0, stoppedByQuota: true })).toBe(true);
  });

  it("widens the slate only for raw fixtures with an exact complete provider odds receipt", async () => {
    const kickoff = "2026-08-23T14:00:00Z";
    const fetchImpl = async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.hostname === "v3.football.api-sports.io" && url.pathname === "/fixtures" && url.searchParams.get("date") === "2026-08-23") {
        return json({ response: [
          fixture(9001, 39, "Registered Home", "Registered Away", kickoff),
          fixture(9002, 999, "Exact Priced Home", "Exact Priced Away", "2026-08-23T16:00:00Z"),
          fixture(9003, 999, "Unpriced Home", "Unpriced Away", "2026-08-23T18:00:00Z")
        ] });
      }
      if (url.hostname === "v3.football.api-sports.io" && url.pathname === "/odds") {
        expect(url.searchParams.get("date")).toBe("2026-08-23");
        expect(url.searchParams.get("bet")).toBe("1");
        expect(url.searchParams.get("page")).toBe("1");
        return json({ paging: { current: 1, total: 1 }, response: [apiFootballOddsRow(9002, "2026-08-23T15:35:00Z")] });
      }
      if (url.hostname === "v3.football.api-sports.io") return json({ response: [] });
      return new Response("not found", { status: 404 });
    };
    const provider = new ProviderBackedSportsDataProvider({
      env: { API_FOOTBALL_KEY: "football-key", API_FOOTBALL_ODDS_ENABLED: "true" },
      fetchImpl,
      now: () => new Date("2026-08-23T15:40:00Z")
    });

    const matches = await provider.getFixtures("2026-08-23", "football", { storedEnrichment: false });

    expect(matches.map((match) => match.id)).toEqual(["api-football:9001", "api-football:9002"]);
    const priced = matches[1]!;
    expect(priced.dataSource).toMatchObject({
      fixtureProvider: "api-football",
      fixtureProviderId: "9002",
      oddsProvider: "api-football-odds",
      oddsProviderEventId: "9002",
      oddsCapturedAt: "2026-08-23T15:35:00Z"
    });
    expect(priced.oddsMarkets[0]).toMatchObject({ id: "match_winner", priceMethod: "best-price-per-selection-v1" });
    expect(priced.oddsMarkets[0]?.consensus?.bookmakerCount).toBe(3);
    expect(priced.oddsMarkets[0]?.selections.map((selection) => selection.bookmaker?.id)).toEqual([
      "api-football-bookmaker:8",
      "api-football-bookmaker:11",
      "api-football-bookmaker:8"
    ]);
    expect(priced.oddsMarkets[0]?.selections.every((selection) => selection.observedAt === "2026-08-23T15:35:00Z")).toBe(true);
  });

  it("keeps a complete The Odds API market as the whole-fixture primary source", async () => {
    const fetchImpl = async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.hostname === "v3.football.api-sports.io" && url.pathname === "/fixtures" && url.searchParams.get("date") === "2026-08-23") {
        return json({ response: [fixture(9101, 39, "Primary Home", "Primary Away", "2026-08-23T14:00:00Z")] });
      }
      if (url.hostname === "v3.football.api-sports.io" && url.pathname === "/odds") {
        return json({ paging: { current: 1, total: 1 }, response: [apiFootballOddsRow(9101, "2026-08-23T13:30:00Z", 9, 9, 9)] });
      }
      if (url.hostname === "api.the-odds-api.com" && url.pathname === "/v4/sports/") {
        return json([{ key: "soccer_epl", active: true, has_outrights: false }]);
      }
      if (url.hostname === "api.the-odds-api.com" && url.pathname === "/v4/sports/soccer_epl/events/") {
        return json([{
          id: "the-odds-event-9101",
          sport_key: "soccer_epl",
          commence_time: "2026-08-23T14:00:00Z",
          home_team: "Primary Home",
          away_team: "Primary Away"
        }]);
      }
      if (url.hostname === "api.the-odds-api.com" && url.pathname.endsWith("/odds/")) {
        return json([{
          id: "the-odds-event-9101",
          sport_key: "soccer_epl",
          commence_time: "2026-08-23T14:00:00Z",
          home_team: "Primary Home",
          away_team: "Primary Away",
          last_update: "2026-08-23T13:50:00Z",
          bookmakers: [{
            key: "primary-book",
            title: "Primary Book",
            last_update: "2026-08-23T13:50:00Z",
            markets: [{ key: "h2h", outcomes: [{ name: "Primary Home", price: 2.1 }, { name: "Draw", price: 3.2 }, { name: "Primary Away", price: 3.4 }] }]
          }]
        }]);
      }
      if (url.hostname === "v3.football.api-sports.io") return json({ response: [] });
      return new Response("not found", { status: 404 });
    };
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        API_FOOTBALL_KEY: "football-key",
        API_FOOTBALL_ODDS_ENABLED: "true",
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_FOOTBALL_SPORT_KEYS: "soccer_epl"
      },
      fetchImpl,
      now: () => new Date("2026-08-23T14:00:00Z")
    });

    const [match] = await provider.getFixtures("2026-08-23", "football", { storedEnrichment: false });

    expect(match?.dataSource?.oddsProvider).toBe("the-odds-api");
    expect(match?.dataSource?.oddsProviderEventId).toBe("the-odds-event-9101");
    expect(match?.oddsMarkets[0]?.selections.map((selection) => selection.decimalOdds)).toEqual([2.1, 3.2, 3.4]);
    expect(match?.oddsMarkets[0]?.selections.every((selection) => selection.bookmaker?.id === "primary-book")).toBe(true);
  });

  it("does not widen the slate or attach prices from a stale exact-ID receipt", async () => {
    const fetchImpl = async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));
      if (url.hostname === "v3.football.api-sports.io" && url.pathname === "/fixtures") {
        return json({ response: [
          fixture(9201, 39, "Registered Home", "Registered Away", "2026-08-23T20:00:00Z"),
          fixture(9202, 999, "Stale Home", "Stale Away", "2026-08-23T21:00:00Z")
        ] });
      }
      if (url.hostname === "v3.football.api-sports.io" && url.pathname === "/odds") {
        return json({ paging: { current: 1, total: 1 }, response: [apiFootballOddsRow(9202, "2026-08-23T15:00:00Z")] });
      }
      if (url.hostname === "v3.football.api-sports.io") return json({ response: [] });
      if (url.hostname === "api.the-odds-api.com" && url.pathname === "/v4/sports/") {
        return json([{ key: "soccer_epl", active: true, has_outrights: false }]);
      }
      if (url.hostname === "api.the-odds-api.com" && url.pathname === "/v4/sports/soccer_epl/events/") {
        return json([{
          id: "stale-the-odds-event",
          sport_key: "soccer_epl",
          commence_time: "2026-08-23T20:00:00Z",
          home_team: "Registered Home",
          away_team: "Registered Away"
        }]);
      }
      if (url.hostname === "api.the-odds-api.com" && url.pathname.endsWith("/odds/")) {
        return json([{
          id: "stale-the-odds-event",
          sport_key: "soccer_epl",
          commence_time: "2026-08-23T20:00:00Z",
          home_team: "Registered Home",
          away_team: "Registered Away",
          last_update: "2026-08-23T15:00:00Z",
          bookmakers: [{
            key: "stale-book",
            title: "Stale Book",
            last_update: "2026-08-23T15:00:00Z",
            markets: [{ key: "h2h", outcomes: [{ name: "Registered Home", price: 2.1 }, { name: "Draw", price: 3.2 }, { name: "Registered Away", price: 3.4 }] }]
          }]
        }]);
      }
      return new Response("not found", { status: 404 });
    };
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        API_FOOTBALL_KEY: "football-key",
        API_FOOTBALL_ODDS_ENABLED: "true",
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_FOOTBALL_SPORT_KEYS: "soccer_epl"
      },
      fetchImpl,
      now: () => new Date("2026-08-23T18:00:00Z")
    });

    const matches = await provider.getFixtures("2026-08-23", "football", { storedEnrichment: false });

    expect(matches.map((match) => match.id)).toEqual(["api-football:9201"]);
    expect(matches[0]?.oddsMarkets).toEqual([]);
    expect(matches[0]?.dataSource?.oddsProvider).toBeUndefined();
  });
});
