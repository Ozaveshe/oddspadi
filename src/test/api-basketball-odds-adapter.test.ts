import { describe, expect, it, vi } from "vitest";
import {
  API_BASKETBALL_HOME_AWAY_BET_ID,
  API_BASKETBALL_ODDS_HARD_MAX_CONCURRENCY,
  fetchApiBasketballMoneylineOdds,
  type ApiBasketballOddsTargetGame
} from "@/lib/sports/providers/apiBasketballOdds";

type BookmakerInput = {
  id?: number | string;
  name?: string;
  values: Array<{ value: string; odd: number | string; suspended?: boolean | string }>;
  betId?: number | string;
  betName?: string;
};

function bookmaker({ id = 6, name = "Book A", values, betId = 2, betName = "Home/Away" }: BookmakerInput) {
  return { id, name, bets: [{ id: betId, name: betName, values }] };
}

function completeValues(home: number | string, away: number | string) {
  return [
    { value: "Home", odd: home },
    { value: "Away", odd: away }
  ];
}

function oddsRow({
  gameId,
  leagueId,
  season,
  update = "2026-07-18T08:00:00+00:00",
  bookmakers
}: {
  gameId?: number | string;
  leagueId?: number | string;
  season?: number | string;
  update?: string | null;
  bookmakers: unknown[];
}) {
  return {
    game: gameId === undefined ? {} : { id: gameId },
    league: { id: leagueId, season },
    ...(update === null ? {} : { update }),
    bookmakers
  };
}

function jsonResponse({
  rows,
  status = 200,
  requestsRemaining = 100,
  rateRemaining = 20,
  errors = {},
  includeQuota = true
}: {
  rows: unknown[];
  status?: number;
  requestsRemaining?: number;
  rateRemaining?: number;
  errors?: unknown;
  includeQuota?: boolean;
}): Response {
  return new Response(JSON.stringify({ results: rows.length, response: rows, errors }), {
    status,
    headers: {
      "content-type": "application/json",
      ...(includeQuota ? {
        "x-ratelimit-requests-limit": "7500",
        "x-ratelimit-requests-remaining": String(requestsRemaining),
        "x-ratelimit-limit": "300",
        "x-ratelimit-remaining": String(rateRemaining)
      } : {})
    }
  });
}

function target(providerGameId: string, providerLeagueId: string, season: string): ApiBasketballOddsTargetGame {
  return { providerGameId, providerLeagueId, season };
}

describe("API-Basketball odds adapter", () => {
  it("groups exact target games by league/season and builds best-price no-vig moneylines", async () => {
    const calls: Array<{ url: URL; headers: Headers }> = [];
    let active = 0;
    let maximumActive = 0;
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, headers: new Headers(init?.headers) });
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      const league = url.searchParams.get("league")!;
      const season = url.searchParams.get("season")!;
      const gameId = league === "12" ? "1001" : league === "22" ? "2002" : "3003";
      const books = league === "22"
        ? [
            bookmaker({ id: 6, name: "Book A", values: completeValues(2.1, 1.8) }),
            bookmaker({ id: 8, name: "Book B", values: completeValues(2, 1.9) })
          ]
        : [bookmaker({ values: completeValues(1.9, 2) })];
      return jsonResponse({
        rows: [oddsRow({ gameId, leagueId: league, season, update: "2026-07-18T08:05:00Z", bookmakers: books })],
        requestsRemaining: 100 - Number(league),
        rateRemaining: 20 - calls.length
      });
    });

    const result = await fetchApiBasketballMoneylineOdds({
      targetGames: [
        target("2002", "22", "2025-2026"),
        target("1001", "12", "2025-2026"),
        target("3003", "33", "2026")
      ],
      apiKey: "private-key",
      fetchImpl,
      concurrency: 2,
      requestsReserve: 5,
      rateReserve: 1
    });

    expect(calls.map((call) => `${call.url.searchParams.get("league")}:${call.url.searchParams.get("season")}`)).toEqual([
      "12:2025-2026",
      "22:2025-2026",
      "33:2026"
    ]);
    expect(calls.every((call) => call.url.pathname === "/odds")).toBe(true);
    expect(calls.every((call) => call.url.searchParams.get("bet") === API_BASKETBALL_HOME_AWAY_BET_ID)).toBe(true);
    expect(calls.every((call) => call.headers.get("x-apisports-key") === "private-key")).toBe(true);
    expect(maximumActive).toBe(2);
    expect(result.requests).toEqual(expect.objectContaining({
      providerGroups: 3,
      groupsRequested: 3,
      groupsSucceeded: 3,
      groupsFailed: 0,
      groupsSkipped: 0,
      complete: true,
      concurrency: 2
    }));
    expect(result.quota).toEqual({ requestsLimit: 7500, requestsRemaining: 67, rateLimit: 300, rateRemaining: 17 });

    const game = result.games.find((item) => item.providerGameId === "2002");
    expect(game).toEqual(expect.objectContaining({
      providerGameId: "2002",
      providerLeagueId: "22",
      season: "2025-2026",
      providerUpdatedAt: "2026-07-18T08:05:00Z",
      sourceBookmakers: [
        { providerBookmakerId: "6", bookmakerId: "api-basketball-bookmaker:6", name: "Book A", providerUpdatedAt: "2026-07-18T08:05:00Z" },
        { providerBookmakerId: "8", bookmakerId: "api-basketball-bookmaker:8", name: "Book B", providerUpdatedAt: "2026-07-18T08:05:00Z" }
      ]
    }));
    expect(game?.oddsMarkets).toHaveLength(1);
    expect(game?.oddsMarkets[0]).toEqual(expect.objectContaining({
      id: "match_winner",
      name: "Moneyline",
      priceMethod: "best-price-per-selection-v1",
      consensus: expect.objectContaining({ method: "median-shin-no-vig-v2", bookmakerCount: 2 })
    }));
    expect(game?.oddsMarkets[0]?.bookmaker).toBeUndefined();
    expect(game?.oddsMarkets[0]?.selections).toEqual([
      { id: "home", label: "Home", decimalOdds: 2.1, bookmaker: { id: "api-basketball-bookmaker:6", name: "Book A" }, observedAt: "2026-07-18T08:05:00Z" },
      { id: "away", label: "Away", decimalOdds: 1.9, bookmaker: { id: "api-basketball-bookmaker:8", name: "Book B" }, observedAt: "2026-07-18T08:05:00Z" }
    ]);
  });

  it("joins only exact game/league/season rows and rejects malformed or incomplete bookmaker evidence", async () => {
    const exactTimestamp = "2026-07-18T08:00:00+00:00";
    const valid = bookmaker({ id: "006", name: "Exact Book", values: completeValues("1.91", "2.05") });
    const incomplete = bookmaker({ id: 7, name: "Missing Away", values: [{ value: "Home", odd: 2 }] });
    const invalidPrice = bookmaker({ id: 8, name: "Bad Price", values: completeValues(1, 2.1) });
    const suspended = bookmaker({
      id: 9,
      name: "Suspended",
      values: [{ value: "Home", odd: 2 }, { value: "Away", odd: 2.1, suspended: true }]
    });
    const wrongBet = bookmaker({ id: 10, name: "Wrong Bet", betId: 1, values: completeValues(2, 2.1) });
    const missingIdentity = bookmaker({ id: 11, name: "", values: completeValues(2, 2.1) });
    const rows = [
      oddsRow({ gameId: "00123", leagueId: "012", season: "2025-2026", update: exactTimestamp, bookmakers: [valid, incomplete, invalidPrice, suspended, wrongBet, missingIdentity] }),
      oddsRow({ gameId: "999", leagueId: "012", season: "2025-2026", update: exactTimestamp, bookmakers: [valid] }),
      oddsRow({ gameId: "00123", leagueId: "13", season: "2025-2026", update: exactTimestamp, bookmakers: [valid] }),
      oddsRow({ gameId: "00123", leagueId: "012", season: "2026-2027", update: exactTimestamp, bookmakers: [valid] }),
      oddsRow({ gameId: "00123", leagueId: "012", season: "2025-2026", update: null, bookmakers: [valid] }),
      oddsRow({ gameId: "00124", leagueId: "012", season: "2025-2026", update: exactTimestamp, bookmakers: [incomplete] })
    ];

    const result = await fetchApiBasketballMoneylineOdds({
      targetGames: [target("00123", "012", "2025-2026"), target("00124", "012", "2025-2026")],
      apiKey: "key",
      fetchImpl: async () => jsonResponse({ rows })
    });

    expect(result.games).toHaveLength(1);
    expect(result.games[0]).toEqual(expect.objectContaining({
      providerGameId: "00123",
      providerLeagueId: "012",
      season: "2025-2026",
      providerUpdatedAt: exactTimestamp,
      sourceBookmakers: [{
        providerBookmakerId: "006",
        bookmakerId: "api-basketball-bookmaker:006",
        name: "Exact Book",
        providerUpdatedAt: exactTimestamp
      }]
    }));
    expect(result.games[0]?.oddsMarkets[0]?.selections.every((selection) => selection.decimalOdds > 1)).toBe(true);
    expect(result.normalization).toEqual({
      targetGames: 2,
      rowsReceived: 6,
      rowsRejected: 5,
      bookmakerQuotesAccepted: 1,
      bookmakerQuotesRejected: 6,
      gamesAccepted: 1
    });
  });

  it("never treats HTTP receipt time as provider freshness when update is absent", async () => {
    const result = await fetchApiBasketballMoneylineOdds({
      targetGames: [target("44", "12", "2025-2026")],
      apiKey: "key",
      fetchImpl: async () => new Response(JSON.stringify({
        response: [oddsRow({
          gameId: "44",
          leagueId: "12",
          season: "2025-2026",
          update: null,
          bookmakers: [bookmaker({ values: completeValues(1.8, 2.1) })]
        })]
      }), {
        headers: {
          "content-type": "application/json",
          date: "Sat, 18 Jul 2026 08:10:00 GMT",
          "x-ratelimit-requests-remaining": "99"
        }
      })
    });

    expect(result.games).toEqual([]);
    expect(result.normalization).toEqual(expect.objectContaining({ rowsReceived: 1, rowsRejected: 1, gamesAccepted: 0 }));
  });

  it("stops group fan-out before the configured quota reserve", async () => {
    const requestedLeagues: string[] = [];
    const result = await fetchApiBasketballMoneylineOdds({
      targetGames: [target("1", "1", "2026"), target("2", "2", "2026"), target("3", "3", "2026"), target("4", "4", "2026")],
      apiKey: "key",
      concurrency: 99,
      requestsReserve: 2,
      rateReserve: 1,
      fetchImpl: async (input) => {
        const league = new URL(String(input)).searchParams.get("league")!;
        requestedLeagues.push(league);
        return jsonResponse({ rows: [], requestsRemaining: league === "1" ? 3 : 2, rateRemaining: 100 });
      }
    });

    expect(requestedLeagues).toEqual(["1", "2"]);
    expect(result.requests).toEqual(expect.objectContaining({
      providerGroups: 4,
      concurrency: API_BASKETBALL_ODDS_HARD_MAX_CONCURRENCY,
      groupsRequested: 2,
      groupsSkipped: 2,
      stoppedByQuota: true,
      complete: false
    }));
    expect(result.quota.requestsRemaining).toBe(2);
  });

  it("spends local quota pessimistically when later failures omit quota headers", async () => {
    const requestedLeagues: string[] = [];
    const result = await fetchApiBasketballMoneylineOdds({
      targetGames: [target("1", "1", "2026"), target("2", "2", "2026"), target("3", "3", "2026"), target("4", "4", "2026")],
      apiKey: "key",
      concurrency: 5,
      requestsReserve: 5,
      rateReserve: 1,
      fetchImpl: async (input) => {
        const league = new URL(String(input)).searchParams.get("league")!;
        requestedLeagues.push(league);
        if (league === "1") return jsonResponse({ rows: [], requestsRemaining: 7, rateRemaining: 100 });
        return new Response("upstream failure", { status: 500 });
      }
    });

    expect(requestedLeagues).toEqual(["1", "2", "3"]);
    expect(result.requests).toEqual(expect.objectContaining({
      groupsRequested: 3,
      groupsFailed: 2,
      groupsSkipped: 1,
      stoppedByQuota: true,
      complete: false
    }));
  });

  it("keeps the first group and stops when successful quota telemetry is absent", async () => {
    const requestedLeagues: string[] = [];
    const result = await fetchApiBasketballMoneylineOdds({
      targetGames: [target("1", "1", "2026"), target("2", "2", "2026")],
      apiKey: "key",
      fetchImpl: async (input) => {
        requestedLeagues.push(new URL(String(input)).searchParams.get("league")!);
        return jsonResponse({ rows: [], includeQuota: false });
      }
    });

    expect(requestedLeagues).toEqual(["1"]);
    expect(result.requests).toEqual(expect.objectContaining({
      groupsRequested: 1,
      groupsSkipped: 1,
      stoppedByQuota: true,
      complete: false
    }));
  });

  it("never requests beyond the explicit group cap", async () => {
    const requestedLeagues: string[] = [];
    const result = await fetchApiBasketballMoneylineOdds({
      targetGames: [target("1", "1", "2026"), target("2", "2", "2026"), target("3", "3", "2026")],
      apiKey: "key",
      maxGroups: 2,
      concurrency: 2,
      requestsReserve: 0,
      rateReserve: 0,
      fetchImpl: async (input) => {
        requestedLeagues.push(new URL(String(input)).searchParams.get("league")!);
        return jsonResponse({ rows: [], requestsRemaining: 7000, rateRemaining: 250 });
      }
    });

    expect(requestedLeagues).toEqual(["1", "2"]);
    expect(result.requests).toEqual(expect.objectContaining({
      providerGroups: 3,
      maxGroups: 2,
      groupsRequested: 2,
      groupsSkipped: 1,
      cappedByMaxGroups: true,
      stoppedByQuota: false,
      complete: false
    }));
  });

  it("surfaces provider quota and malformed-response failures without inventing markets", async () => {
    const quotaFailure = await fetchApiBasketballMoneylineOdds({
      targetGames: [target("1", "1", "2026"), target("2", "2", "2026")],
      apiKey: "key",
      fetchImpl: async () => jsonResponse({
        rows: [],
        requestsRemaining: 0,
        errors: { requests: "Daily request limit reached" }
      })
    });
    expect(quotaFailure.games).toEqual([]);
    expect(quotaFailure.requests).toEqual(expect.objectContaining({
      groupsRequested: 1,
      groupsFailed: 1,
      groupsSkipped: 1,
      stoppedByQuota: true,
      complete: false
    }));
    expect(quotaFailure.groups[0]).toEqual(expect.objectContaining({
      ok: false,
      httpStatus: 200,
      error: "requests: Daily request limit reached"
    }));

    const malformed = await fetchApiBasketballMoneylineOdds({
      targetGames: [target("1", "1", "2026")],
      apiKey: "key",
      fetchImpl: async () => new Response(JSON.stringify({ results: 0 }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    });
    expect(malformed.games).toEqual([]);
    expect(malformed.groups[0]?.error).toContain("malformed odds response");
  });

  it("rejects invalid or conflicting target identities before making a request", async () => {
    const fetchImpl = vi.fn();
    await expect(fetchApiBasketballMoneylineOdds({
      targetGames: [target("not-a-game", "12", "2025-2026")],
      apiKey: "key",
      fetchImpl
    })).rejects.toThrow("positive numeric game/league IDs");
    await expect(fetchApiBasketballMoneylineOdds({
      targetGames: [target("1", "12", "2025-2026"), target("1", "13", "2025-2026")],
      apiKey: "key",
      fetchImpl
    })).rejects.toThrow("conflicting league/season groups");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
