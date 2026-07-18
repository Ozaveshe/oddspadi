import { describe, expect, it } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";
import { buildFootballProviderLiveFeatureMaterializer } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";

describe("provider-backed football odds merge", () => {
  it("keeps API-Football fixtures while merging aliased The Odds API markets and appending unmatched odds events", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const url = String(input);
      calls.push(url);

      if (url.includes("football.api-sports.io/fixtures/lineups") || url.includes("football.api-sports.io/injuries") || url.includes("football.api-sports.io/fixtures/events")) {
        expect(new Headers(init?.headers).get("x-apisports-key")).toBe("football-key");
        return new Response(JSON.stringify({ response: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.includes("football.api-sports.io/standings")) {
        return new Response(JSON.stringify({ response: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.includes("football.api-sports.io/fixtures?") && url.includes("team=")) {
        return new Response(JSON.stringify({ response: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
      }

      if (url.includes("football.api-sports.io/fixtures?") && url.includes("date=2026-08-23")) {
        expect(new Headers(init?.headers).get("x-apisports-key")).toBe("football-key");
        return new Response(
          JSON.stringify({
            response: [
              {
                fixture: { id: 8201, date: "2026-08-23T14:00:00Z", status: { short: "NS" }, venue: { name: "Amex Stadium", city: "Brighton" } },
                league: { id: 39, name: "Premier League", country: "England", season: 2026 },
                teams: {
                  home: { id: 397, name: "Brighton" },
                  away: { id: 66, name: "Aston Villa" }
                },
                goals: { home: null, away: null }
              },
              {
                fixture: { id: 8202, date: "2026-08-23T16:30:00Z", status: { short: "NS" }, venue: { name: "St James' Park", city: "Newcastle" } },
                league: { id: 39, name: "Premier League", country: "England", season: 2026 },
                teams: {
                  home: { id: 34, name: "Newcastle United" },
                  away: { id: 40, name: "Liverpool" }
                },
                goals: { home: null, away: null }
              }
            ]
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.includes("api.the-odds-api.com/v4/sports/soccer_epl/odds")) {
        return new Response(
          JSON.stringify([
            {
              id: "odds-brighton-villa",
              sport_key: "soccer_epl",
              sport_title: "EPL",
              commence_time: "2026-08-23T14:00:00Z",
              last_update: "2026-08-23T13:20:00Z",
              home_team: "Brighton & Hove Albion",
              away_team: "Aston Villa",
              bookmakers: [
                {
                  key: "book",
                  title: "Book",
                  last_update: "2026-08-23T13:20:00Z",
                  markets: [
                    {
                      key: "h2h",
                      last_update: "2026-08-23T13:20:00Z",
                      outcomes: [
                        { name: "Brighton", price: 2.35 },
                        { name: "Draw", price: 3.45 },
                        { name: "Aston Villa", price: 3.1 }
                      ]
                    }
                  ]
                }
              ]
            },
            {
              id: "odds-man-city-bournemouth",
              sport_key: "soccer_epl",
              sport_title: "EPL",
              commence_time: "2026-08-23T14:00:00Z",
              last_update: "2026-08-23T13:20:00Z",
              home_team: "Man City",
              away_team: "AFC Bournemouth",
              bookmakers: [
                {
                  key: "book",
                  title: "Book",
                  last_update: "2026-08-23T13:20:00Z",
                  markets: [
                    {
                      key: "h2h",
                      last_update: "2026-08-23T13:20:00Z",
                      outcomes: [
                        { name: "Man City", price: 1.42 },
                        { name: "Draw", price: 5.2 },
                        { name: "AFC Bournemouth", price: 8.0 }
                      ]
                    }
                  ]
                }
              ]
            }
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response("not found", { status: 404 });
    };

    const provider = new ProviderBackedSportsDataProvider({
      env: { API_FOOTBALL_KEY: "football-key", THE_ODDS_API_KEY: "odds-key" },
      fetchImpl,
      now: () => new Date("2026-08-23T13:30:00Z")
    });

    const matches = await provider.getFixtures("2026-08-23", "football");
    const brighton = matches.find((match) => match.id === "api-football:8201");
    const appended = matches.find((match) => match.id === "the-odds-api:odds-man-city-bournemouth");

    expect(calls.some((url) => url.includes("football.api-sports.io/fixtures?date=2026-08-23"))).toBe(true);
    expect(calls.some((url) => url.includes("api.the-odds-api.com/v4/sports/soccer_epl/odds"))).toBe(true);
    expect(matches.map((match) => match.id)).toEqual(["api-football:8201", "api-football:8202", "the-odds-api:odds-man-city-bournemouth"]);
    expect(brighton?.dataSource?.fixtureProvider).toBe("api-football");
    expect(brighton?.dataSource?.fixtureProviderId).toBe("8201");
    expect(brighton?.dataSource?.oddsProvider).toBe("the-odds-api");
    expect(brighton?.dataSource?.oddsProviderEventId).toBe("odds-brighton-villa");
    expect(brighton?.dataSource?.notes).not.toContain("No matching live odds snapshot was found for this fixture.");
    expect(brighton?.oddsMarkets[0]?.selections.map((selection) => selection.decimalOdds)).toEqual([2.35, 3.45, 3.1]);
    expect(appended?.dataSource?.fixtureProvider).toBe("the-odds-api-events");
    expect(appended?.dataSource?.fixtureProviderId).toBe("odds-man-city-bournemouth");
    expect(appended?.dataSource?.oddsProvider).toBe("the-odds-api");
    expect(appended?.dataSource?.oddsProviderEventId).toBe("odds-man-city-bournemouth");

    const materializer = buildFootballProviderLiveFeatureMaterializer({
      provider: "api-football+the-odds-api",
      matches,
      targetDate: "2026-08-23",
      now: new Date("2026-07-09T20:30:00.000Z")
    });

    expect(materializer.previewRows.map((row) => [row.fixture_external_id, row.source])).toEqual([
      ["epl-2026-brighton-and-hove-albion-aston-villa", "epl-2026-opening-live-provider"],
      ["epl-2026-manchester-city-afc-bournemouth", "epl-2026-opening-live-provider"]
    ]);
    expect((materializer.previewRows[0].features as any).providerFixtureExternalId).toBe("api-football:8201");
    expect((materializer.previewRows[1].features as any).providerFixtureExternalId).toBe("the-odds-api:odds-man-city-bournemouth");
  });
});
