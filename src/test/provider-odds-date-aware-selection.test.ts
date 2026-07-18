import { describe, expect, it } from "vitest";
import { ProviderBackedSportsDataProvider } from "@/lib/sports/providers/providerBackedProvider";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}

function catalogEvent(sportKey: string, id: string, commenceTime: string) {
  return {
    id,
    sport_key: sportKey,
    sport_title: sportKey,
    commence_time: commenceTime,
    home_team: `${sportKey} Home ${id}`,
    away_team: `${sportKey} Away ${id}`
  };
}

function pricedEvent(sportKey: string, id: string, commenceTime: string) {
  const home = `${sportKey} Home ${id}`;
  const away = `${sportKey} Away ${id}`;
  const observedAt = `${commenceTime.slice(0, 10)}T09:50:00Z`;
  return {
    ...catalogEvent(sportKey, id, commenceTime),
    last_update: observedAt,
    bookmakers: [
      {
        key: "verified-book",
        title: "Verified Book",
        last_update: observedAt,
        markets: [
          {
            key: "h2h",
            last_update: observedAt,
            outcomes: [
              { name: home, price: 2.25 },
              { name: "Draw", price: 3.2 },
              { name: away, price: 3.05 }
            ]
          }
        ]
      }
    ]
  };
}

function sportKeyFromPath(pathname: string): string {
  return decodeURIComponent(pathname.split("/")[3] ?? "");
}

describe("The Odds API date-aware paid-feed selection", () => {
  it("pays only for configured keys with events on the requested UTC date and defaults to h2h", async () => {
    const calls: URL[] = [];
    const keys = ["soccer_irrelevant", "soccer_preferred", "soccer_another"];
    const fetchImpl = async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname === "/v4/sports/") {
        return json(keys.map((key) => ({ key, active: true, has_outrights: false })));
      }
      if (url.pathname.endsWith("/events/")) {
        const sportKey = sportKeyFromPath(url.pathname);
        const commenceTime = sportKey === "soccer_irrelevant" ? "2026-07-21T10:00:00Z" : "2026-07-20T10:00:00Z";
        return json([catalogEvent(sportKey, `${sportKey}-event`, commenceTime)]);
      }
      if (url.pathname.endsWith("/odds/")) {
        const sportKey = sportKeyFromPath(url.pathname);
        return json([pricedEvent(sportKey, `${sportKey}-event`, "2026-07-20T10:00:00Z")]);
      }
      return new Response("not found", { status: 404 });
    };
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_FOOTBALL_SPORT_KEYS: keys.slice(0, 2).join(",")
      },
      fetchImpl,
      now: () => new Date("2026-07-20T10:00:00Z"),
      historicalFootballEloLoader: async () => new Map()
    });

    await provider.getFixtures("2026-07-20", "football");

    const paidCalls = calls.filter((url) => url.pathname.endsWith("/odds/") && !url.pathname.includes("/events/"));
    const catalogueCalls = calls.filter((url) => url.pathname.endsWith("/events/"));
    expect(paidCalls.map((url) => sportKeyFromPath(url.pathname)).sort()).toEqual(["soccer_another", "soccer_preferred"]);
    expect(paidCalls.every((url) => url.searchParams.get("markets") === "h2h")).toBe(true);
    expect(catalogueCalls.every((url) => url.searchParams.get("commenceTimeFrom") === "2026-07-20T00:00:00Z")).toBe(true);
    expect(catalogueCalls.every((url) => url.searchParams.get("commenceTimeTo") === "2026-07-21T00:00:00Z")).toBe(true);
    expect(calls.some((url) => url.pathname.includes("/sports/soccer_irrelevant/odds/"))).toBe(false);
    expect(calls.some((url) => /\/events\/[^/]+\/odds\/?$/.test(url.pathname))).toBe(false);
  });

  it("makes no paid odds call after a successful empty event catalogue read", async () => {
    const calls: URL[] = [];
    const fetchImpl = async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname === "/v4/sports/") return json([{ key: "soccer_empty", active: true, has_outrights: false }]);
      if (url.pathname === "/v4/sports/soccer_empty/events/") return json([]);
      if (url.pathname.endsWith("/odds/")) return json([]);
      return new Response("not found", { status: 404 });
    };
    const provider = new ProviderBackedSportsDataProvider({
      env: { THE_ODDS_API_KEY: "odds-key", ODDS_API_FOOTBALL_SPORT_KEYS: "soccer_empty" },
      fetchImpl,
      historicalFootballEloLoader: async () => new Map()
    });

    await provider.getFixtures("2026-07-20", "football");

    expect(calls.filter((url) => url.pathname === "/v4/sports/soccer_empty/events/")).toHaveLength(1);
    expect(calls.filter((url) => url.pathname.endsWith("/odds/"))).toHaveLength(0);
  });

  it("falls back to only the explicit key when both free catalogues are unavailable", async () => {
    const calls: URL[] = [];
    const fetchImpl = async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname === "/v4/sports/" || url.pathname.endsWith("/events/")) {
        return new Response("catalogue unavailable", { status: 503 });
      }
      if (url.pathname === "/v4/sports/soccer_operator/odds/") return json([]);
      return new Response("not found", { status: 404 });
    };
    const provider = new ProviderBackedSportsDataProvider({
      env: { THE_ODDS_API_KEY: "odds-key", ODDS_API_FOOTBALL_SPORT_KEYS: "soccer_operator" },
      fetchImpl,
      historicalFootballEloLoader: async () => new Map()
    });

    await provider.getFixtures("2026-07-20", "football");

    const paidCalls = calls.filter((url) => url.pathname.endsWith("/odds/") && !url.pathname.includes("/events/"));
    expect(paidCalls.map((url) => sportKeyFromPath(url.pathname))).toEqual(["soccer_operator"]);
    expect(paidCalls[0]?.searchParams.get("markets")).toBe("h2h");
  });

  it("applies the eight-key cap after date relevance and keeps the configured key first", async () => {
    const calls: URL[] = [];
    const discovered = Array.from({ length: 9 }, (_, index) => `basketball_key_${index + 1}`);
    const keys = ["basketball_priority", ...discovered];
    const fetchImpl = async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname === "/v4/sports/") {
        return json(keys.map((key) => ({ key, active: true, has_outrights: false })));
      }
      if (url.pathname.endsWith("/events/")) {
        const sportKey = sportKeyFromPath(url.pathname);
        const count = sportKey === "basketball_priority" ? 1 : Number(sportKey.split("_").at(-1));
        return json(
          Array.from({ length: count }, (_, index) => catalogEvent(sportKey, `${sportKey}-${index}`, `2026-07-20T${String(index + 1).padStart(2, "0")}:00:00Z`))
        );
      }
      if (url.pathname.endsWith("/odds/") || url.pathname.endsWith("/scores/")) return json([]);
      return new Response("not found", { status: 404 });
    };
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_BASKETBALL_SPORT_KEYS: "basketball_priority"
      },
      fetchImpl,
      historicalBasketballStrengthLoader: async () => new Map()
    });

    await provider.getFixtures("2026-07-20", "basketball");

    const paidKeys = calls
      .filter((url) => url.pathname.endsWith("/odds/") && !url.pathname.includes("/events/"))
      .map((url) => sportKeyFromPath(url.pathname));
    expect(paidKeys).toHaveLength(8);
    expect(paidKeys).toContain("basketball_priority");
    expect(paidKeys).toEqual(expect.arrayContaining(["basketball_key_9", "basketball_key_8", "basketball_key_7"]));
    expect(paidKeys).not.toEqual(expect.arrayContaining(["basketball_key_1", "basketball_key_2"]));
  });

  it("requests extra core and football event markets only when explicitly configured", async () => {
    const calls: URL[] = [];
    const fetchImpl = async (input: string | URL): Promise<Response> => {
      const url = new URL(String(input));
      calls.push(url);
      if (url.pathname === "/v4/sports/") return json([{ key: "soccer_epl", active: true, has_outrights: false }]);
      if (url.pathname === "/v4/sports/soccer_epl/events/") {
        return json([catalogEvent("soccer_epl", "market-event", "2099-07-20T10:00:00Z")]);
      }
      if (url.pathname === "/v4/sports/soccer_epl/odds/") {
        return json([pricedEvent("soccer_epl", "market-event", "2099-07-20T10:00:00Z")]);
      }
      if (url.pathname === "/v4/sports/soccer_epl/events/market-event/odds") {
        return json({
          id: "market-event",
          sport_key: "soccer_epl",
          last_update: "2099-07-20T09:50:00Z",
          bookmakers: [
            {
              key: "verified-book",
              title: "Verified Book",
              last_update: "2099-07-20T09:50:00Z",
              markets: [
                {
                  key: "btts",
                  last_update: "2099-07-20T09:50:00Z",
                  outcomes: [
                    { name: "Yes", price: 1.85 },
                    { name: "No", price: 1.95 }
                  ]
                }
              ]
            }
          ]
        });
      }
      return new Response("not found", { status: 404 });
    };
    const provider = new ProviderBackedSportsDataProvider({
      env: {
        THE_ODDS_API_KEY: "odds-key",
        ODDS_API_CORE_MARKETS: "h2h,totals",
        ODDS_API_FOOTBALL_EVENT_MARKETS: "btts",
        ODDS_API_FOOTBALL_EVENT_MARKET_LIMIT: "1"
      },
      fetchImpl,
      now: () => new Date("2099-07-20T10:00:00Z"),
      historicalFootballEloLoader: async () => new Map()
    });

    await provider.getFixtures("2099-07-20", "football");

    const baseCall = calls.find((url) => url.pathname === "/v4/sports/soccer_epl/odds/");
    const eventCall = calls.find((url) => url.pathname === "/v4/sports/soccer_epl/events/market-event/odds");
    expect(baseCall?.searchParams.get("markets")).toBe("h2h,totals");
    expect(eventCall?.searchParams.get("markets")).toBe("btts");
  });
});
