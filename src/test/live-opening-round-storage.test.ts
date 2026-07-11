import { describe, expect, it } from "vitest";
import { buildFootballProviderLiveOpeningRoundStorageReceipt } from "@/lib/sports/training/footballProviderLiveOpeningRoundStorageReceipt";

function oddsEvent({
  id,
  date,
  home,
  away,
  prices = [2.1, 3.4, 3.8]
}: {
  id: string;
  date: string;
  home: string;
  away: string;
  prices?: [number, number, number];
}) {
  return {
    id,
    sport_key: "soccer_epl",
    sport_title: "EPL",
    commence_time: `${date}T19:00:00Z`,
    home_team: home,
    away_team: away,
    bookmakers: [
      {
        title: "Test Book",
        markets: [
          {
            key: "h2h",
            outcomes: [
              { name: home, price: prices[0] },
              { name: "Draw", price: prices[1] },
              { name: away, price: prices[2] }
            ]
          }
        ]
      }
    ]
  };
}

describe("football provider live opening-round storage receipt", () => {
  it("aggregates provider-backed EPL live feature rows across the opening-round date window", async () => {
    const calls: string[] = [];
    const fetchImpl = async (input: string | URL): Promise<Response> => {
      calls.push(String(input));
      if (String(input).includes("api.the-odds-api.com/v4/sports/soccer_epl/odds")) {
        return new Response(
          JSON.stringify([
            oddsEvent({ id: "odds-arsenal-coventry", date: "2026-08-21", home: "Arsenal", away: "Coventry City", prices: [1.48, 4.8, 7.2] }),
            oddsEvent({ id: "odds-hull-man-utd", date: "2026-08-22", home: "Hull City", away: "Manchester United", prices: [5.4, 4.1, 1.68] }),
            oddsEvent({ id: "odds-everton-palace", date: "2026-08-22", home: "Everton", away: "Crystal Palace", prices: [2.58, 3.15, 2.92] })
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      return new Response("not found", { status: 404 });
    };

    const receipt = await buildFootballProviderLiveOpeningRoundStorageReceipt({
      dates: ["2026-08-21", "2026-08-22"],
      runRequested: false,
      adminAuthorized: false,
      filters: {
        league: "Premier League",
        country: "England",
        query: null
      },
      env: {
        THE_ODDS_API_KEY: "odds-key",
        SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
        SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
        ODDSPADI_ADMIN_TOKEN: "admin-token"
      },
      origin: "http://127.0.0.1:3025",
      fetchImpl,
      now: new Date("2026-07-09T20:00:00.000Z")
    });

    expect(calls.filter((url) => url.includes("/v4/sports/soccer_epl/odds"))).toHaveLength(2);
    expect(calls.every((url) => url.includes("api.the-odds-api.com"))).toBe(true);
    expect(receipt.mode).toBe("football-provider-live-opening-round-storage-receipt");
    expect(receipt.status).toBe("ready-to-store");
    expect(receipt.request.dateWindow).toEqual(["2026-08-21", "2026-08-22"]);
    expect(receipt.request.filters).toEqual({ league: "Premier League", country: "England", query: null });
    expect(receipt.target.expectedFixtures).toBe(6);
    expect(receipt.target.matchedExpectedFixtures).toBe(3);
    expect(receipt.totals.datesRequested).toBe(2);
    expect(receipt.totals.datesWithProviderRows).toBe(2);
    expect(receipt.totals.rowsPreviewed).toBe(3);
    expect(receipt.totals.providerBackedRows).toBe(3);
    expect(receipt.totals.pendingRows).toBe(3);
    expect(receipt.fixtures.map((fixture) => fixture.matchLabel)).toEqual([
      "Arsenal vs Coventry City",
      "Everton vs Crystal Palace",
      "Hull City vs Manchester United"
    ]);
    expect(receipt.fixtures.every((fixture) => fixture.league === "Premier League")).toBe(true);
    expect(receipt.nextAction.command).toContain("dryRun=0");
    expect(receipt.nextAction.command).toContain("run=1");
    expect(receipt.nextAction.verifyUrl).toContain("dates=2026-08-21%2C2026-08-22");
    expect(receipt.controls.canPrepareOpeningRoundFeatureRows).toBe(true);
    expect(receipt.controls.canWriteLiveFeatureSnapshots).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });

  it("keeps opening-round writes locked when run is requested without admin authorization", async () => {
    const fetchImpl = async (): Promise<Response> =>
      new Response(
        JSON.stringify([oddsEvent({ id: "odds-arsenal-coventry", date: "2026-08-21", home: "Arsenal", away: "Coventry City" })]),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const receipt = await buildFootballProviderLiveOpeningRoundStorageReceipt({
      dates: ["2026-08-21"],
      runRequested: true,
      adminAuthorized: false,
      env: {
        THE_ODDS_API_KEY: "odds-key",
        SUPABASE_PROJECT_REF: "wncwtzqipnoqwmqlznqn",
        SUPABASE_URL: "https://wncwtzqipnoqwmqlznqn.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
        ODDSPADI_ADMIN_TOKEN: "admin-token"
      },
      origin: "http://127.0.0.1:3025",
      fetchImpl,
      now: new Date("2026-07-09T20:01:00.000Z")
    });

    expect(receipt.status).toBe("waiting-admin");
    expect(receipt.controls.canWriteLiveFeatureSnapshots).toBe(false);
    expect(receipt.controls.canFeedProviderRetestRunner).toBe(false);
    expect(receipt.controls.canTrainModels).toBe(false);
    expect(receipt.controls.canPublishPicks).toBe(false);
    expect(receipt.controls.canStake).toBe(false);
  });
});
