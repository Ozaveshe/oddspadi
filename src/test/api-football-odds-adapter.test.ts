import { describe, expect, it, vi } from "vitest";
import {
  API_FOOTBALL_ODDS_HARD_MAX_CONCURRENCY,
  fetchApiFootballMatchWinnerOdds
} from "@/lib/sports/providers/apiFootballOdds";

type BookmakerInput = {
  id?: number | string;
  name?: string;
  values: Array<{ value: string; odd: number | string; suspended?: boolean | string }>;
  betId?: number | string;
};

function bookmaker({ id = 6, name = "Book A", values, betId = 1 }: BookmakerInput) {
  return { id, name, bets: [{ id: betId, name: "Match Winner", values }] };
}

function completeValues(home: number | string, draw: number | string, away: number | string) {
  return [
    { value: "Home", odd: home },
    { value: "Draw", odd: draw },
    { value: "Away", odd: away }
  ];
}

function oddsRow({
  fixtureId,
  update = "2026-07-18T08:00:00+00:00",
  bookmakers
}: {
  fixtureId?: number | string;
  update?: string;
  bookmakers: unknown[];
}) {
  return { fixture: fixtureId === undefined ? {} : { id: fixtureId }, update, bookmakers };
}

function jsonPage({
  current,
  total,
  rows,
  status = 200,
  requestsRemaining = 100,
  rateRemaining = 20,
  errors = {}
}: {
  current: number;
  total: number;
  rows: unknown[];
  status?: number;
  requestsRemaining?: number;
  rateRemaining?: number;
  errors?: unknown;
}): Response {
  return new Response(JSON.stringify({ paging: { current, total }, response: rows, errors }), {
    status,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-requests-limit": "7500",
      "x-ratelimit-requests-remaining": String(requestsRemaining),
      "x-ratelimit-limit": "300",
      "x-ratelimit-remaining": String(rateRemaining)
    }
  });
}

describe("API-Football odds adapter", () => {
  it("pages the date/bet feed with bounded concurrency and builds best-price consensus markets", async () => {
    const calls: Array<{ url: URL; headers: Headers }> = [];
    let active = 0;
    let maximumActive = 0;
    const pages = new Map<number, unknown[]>([
      [1, [oddsRow({ fixtureId: 1001, bookmakers: [bookmaker({ values: completeValues("1.90", "3.40", "4.10") })] })]],
      [2, [oddsRow({
        fixtureId: "1002",
        update: "2026-07-18T08:05:00Z",
        bookmakers: [
          bookmaker({ id: 6, name: "Book A", values: completeValues(2.1, 3.2, 3.4) }),
          bookmaker({ id: 8, name: "Book B", values: completeValues(2, 3.4, 3.5) })
        ]
      })]],
      [3, []]
    ]);
    const fetchImpl = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      calls.push({ url, headers: new Headers(init?.headers) });
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await Promise.resolve();
      active -= 1;
      const page = Number(url.searchParams.get("page"));
      return jsonPage({
        current: page,
        total: 3,
        rows: pages.get(page) ?? [],
        requestsRemaining: 100 - page,
        rateRemaining: 20 - page
      });
    });

    const result = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "private-key",
      fetchImpl,
      concurrency: 2,
      requestsReserve: 5,
      rateReserve: 1
    });

    expect(calls.map((call) => call.url.searchParams.get("page"))).toEqual(["1", "2", "3"]);
    expect(calls.every((call) => call.url.pathname === "/odds")).toBe(true);
    expect(calls.every((call) => call.url.searchParams.get("date") === "2026-07-18")).toBe(true);
    expect(calls.every((call) => call.url.searchParams.get("bet") === "1")).toBe(true);
    expect(calls.every((call) => call.headers.get("x-apisports-key") === "private-key")).toBe(true);
    expect(maximumActive).toBe(2);
    expect(result.pagination).toEqual(expect.objectContaining({
      providerTotalPages: 3,
      pagesRequested: 3,
      pagesSucceeded: 3,
      pagesFailed: 0,
      pagesSkipped: 0,
      complete: true,
      concurrency: 2
    }));
    expect(result.quota).toEqual({ requestsLimit: 7500, requestsRemaining: 97, rateLimit: 300, rateRemaining: 17 });

    const fixture = result.fixtures.find((item) => item.providerFixtureId === "1002");
    expect(fixture?.providerUpdatedAt).toBe("2026-07-18T08:05:00Z");
    expect(fixture?.sourceBookmakers).toEqual([
      { providerBookmakerId: "6", bookmakerId: "api-football-bookmaker:6", name: "Book A", providerUpdatedAt: "2026-07-18T08:05:00Z" },
      { providerBookmakerId: "8", bookmakerId: "api-football-bookmaker:8", name: "Book B", providerUpdatedAt: "2026-07-18T08:05:00Z" }
    ]);
    expect(fixture?.oddsMarkets).toHaveLength(1);
    expect(fixture?.oddsMarkets[0]).toEqual(expect.objectContaining({
      id: "match_winner",
      priceMethod: "best-price-per-selection-v1",
      consensus: expect.objectContaining({ method: "median-no-vig-v1", bookmakerCount: 2 })
    }));
    expect(fixture?.oddsMarkets[0]?.bookmaker).toBeUndefined();
    expect(fixture?.oddsMarkets[0]?.selections).toEqual([
      { id: "home", label: "Home", decimalOdds: 2.1, bookmaker: { id: "api-football-bookmaker:6", name: "Book A" }, observedAt: "2026-07-18T08:05:00Z" },
      { id: "draw", label: "Draw", decimalOdds: 3.4, bookmaker: { id: "api-football-bookmaker:8", name: "Book B" }, observedAt: "2026-07-18T08:05:00Z" },
      { id: "away", label: "Away", decimalOdds: 3.5, bookmaker: { id: "api-football-bookmaker:8", name: "Book B" }, observedAt: "2026-07-18T08:05:00Z" }
    ]);
  });

  it("rejects malformed rows, incomplete books, suspended selections, and odds at or below one", async () => {
    const exactTimestamp = "2026-07-18T08:00:00+00:00";
    const valid = bookmaker({ id: "006", name: "Exact Book", values: completeValues("1.91", "3.25", "4.20") });
    const incomplete = bookmaker({ id: 7, name: "Missing Draw", values: [{ value: "Home", odd: 2 }, { value: "Away", odd: 3 }] });
    const invalidPrice = bookmaker({ id: 8, name: "Bad Price", values: completeValues(1, 3.2, 4.1) });
    const suspended = bookmaker({
      id: 9,
      name: "Suspended",
      values: [{ value: "Home", odd: 2 }, { value: "Draw", odd: 3.2, suspended: true }, { value: "Away", odd: 4.1 }]
    });
    const missingIdentity = bookmaker({ id: 10, name: "", values: completeValues(2, 3.2, 4.1) });
    const rows = [
      oddsRow({ fixtureId: "00123", update: exactTimestamp, bookmakers: [valid, incomplete, invalidPrice, suspended, missingIdentity] }),
      oddsRow({ fixtureId: 124, update: exactTimestamp, bookmakers: [incomplete] }),
      oddsRow({ update: exactTimestamp, bookmakers: [valid] }),
      oddsRow({ fixtureId: 125, update: "not-a-time", bookmakers: [valid] })
    ];

    const result = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      fetchImpl: async () => jsonPage({ current: 1, total: 1, rows })
    });

    expect(result.fixtures).toHaveLength(1);
    expect(result.fixtures[0]).toEqual(expect.objectContaining({
      providerFixtureId: "00123",
      providerUpdatedAt: exactTimestamp,
      sourceBookmakers: [{
        providerBookmakerId: "006",
        bookmakerId: "api-football-bookmaker:006",
        name: "Exact Book",
        providerUpdatedAt: exactTimestamp
      }]
    }));
    expect(result.fixtures[0]?.oddsMarkets[0]?.selections.every((selection) => selection.decimalOdds > 1)).toBe(true);
    expect(result.normalization).toEqual({
      rowsReceived: 4,
      rowsRejected: 3,
      bookmakerQuotesAccepted: 1,
      bookmakerQuotesRejected: 5,
      fixturesAccepted: 1
    });
  });

  it("stops page fan-out before the configured quota reserve", async () => {
    const requestedPages: number[] = [];
    const result = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      maxPages: 10,
      concurrency: 99,
      requestsReserve: 2,
      rateReserve: 1,
      fetchImpl: async (input) => {
        const page = Number(new URL(String(input)).searchParams.get("page"));
        requestedPages.push(page);
        return jsonPage({
          current: page,
          total: 100,
          rows: [],
          requestsRemaining: page === 1 ? 3 : 2,
          rateRemaining: 100
        });
      }
    });

    expect(requestedPages).toEqual([1, 2]);
    expect(result.pagination).toEqual(expect.objectContaining({
      providerTotalPages: 100,
      maxPages: 10,
      concurrency: API_FOOTBALL_ODDS_HARD_MAX_CONCURRENCY,
      pagesRequested: 2,
      pagesSkipped: 98,
      cappedByMaxPages: true,
      stoppedByQuota: true,
      complete: false
    }));
    expect(result.quota.requestsRemaining).toBe(2);
  });

  it("spends its local quota allowance even when later failures omit quota headers", async () => {
    const requestedPages: number[] = [];
    const result = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      maxPages: 10,
      concurrency: 5,
      requestsReserve: 5,
      rateReserve: 1,
      fetchImpl: async (input) => {
        const page = Number(new URL(String(input)).searchParams.get("page"));
        requestedPages.push(page);
        if (page === 1) {
          return jsonPage({ current: 1, total: 10, rows: [], requestsRemaining: 7, rateRemaining: 100 });
        }
        return new Response("upstream failure", { status: 500 });
      }
    });

    expect(requestedPages).toEqual([1, 2, 3]);
    expect(result.pagination).toEqual(expect.objectContaining({
      pagesRequested: 3,
      pagesFailed: 2,
      pagesSkipped: 7,
      stoppedByQuota: true,
      complete: false
    }));
  });

  it("retries one transient page once, records both exact attempts, and normalizes the successful rows once", async () => {
    const requestedPages: number[] = [];
    let pageTwoAttempts = 0;
    const result = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      concurrency: 1,
      requestsReserve: 5,
      rateReserve: 1,
      fetchImpl: async (input) => {
        const page = Number(new URL(String(input)).searchParams.get("page"));
        requestedPages.push(page);
        if (page === 1) return jsonPage({ current: 1, total: 2, rows: [], requestsRemaining: 100, rateRemaining: 100 });
        pageTwoAttempts += 1;
        if (pageTwoAttempts === 1) {
          return jsonPage({
            current: 2,
            total: 2,
            rows: [],
            status: 503,
            requestsRemaining: 99,
            rateRemaining: 99,
            errors: { server: "Temporary provider failure" }
          });
        }
        return jsonPage({
          current: 2,
          total: 2,
          rows: [oddsRow({ fixtureId: 2002, bookmakers: [bookmaker({ values: completeValues(2, 3.2, 4) })] })],
          requestsRemaining: 98,
          rateRemaining: 98
        });
      }
    });

    expect(requestedPages).toEqual([1, 2, 2]);
    expect(result.pagination).toEqual(expect.objectContaining({
      pagesRequested: 2,
      pagesSucceeded: 2,
      pagesFailed: 0,
      requestAttempts: 3,
      pagesRetried: 1,
      complete: true
    }));
    expect(result.normalization.rowsReceived).toBe(1);
    expect(result.fixtures.map((fixture) => fixture.providerFixtureId)).toEqual(["2002"]);
    expect(result.pages[1]).toEqual(expect.objectContaining({
      page: 2,
      ok: true,
      attemptCount: 2,
      retried: true,
      attempts: [
        expect.objectContaining({ page: 2, attempt: 1, ok: false, httpStatus: 503 }),
        expect.objectContaining({ page: 2, attempt: 2, ok: true, httpStatus: 200, rowsReceived: 1 })
      ]
    }));
  });

  it("never retries auth or quota failures and never retries a transient page more than once", async () => {
    for (const status of [401, 403, 429]) {
      const fetchImpl = vi.fn(async () => jsonPage({
        current: 1,
        total: 1,
        rows: [],
        status,
        requestsRemaining: status === 429 ? 0 : 100,
        errors: { request: "Rejected" }
      }));
      const failure = await fetchApiFootballMatchWinnerOdds({ date: "2026-07-18", apiKey: "key", fetchImpl });
      expect(fetchImpl, `HTTP ${status}`).toHaveBeenCalledTimes(1);
      expect(failure.pagination.pagesRetried).toBe(0);
      expect(failure.pages[0]?.attemptCount).toBe(1);
    }

    let pageTwoAttempts = 0;
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const page = Number(new URL(String(input)).searchParams.get("page"));
      if (page === 1) return jsonPage({ current: 1, total: 2, rows: [], requestsRemaining: 100, rateRemaining: 100 });
      pageTwoAttempts += 1;
      throw new Error(`timeout-${pageTwoAttempts}`);
    });
    const transient = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      fetchImpl,
      concurrency: 1,
      requestsReserve: 5,
      rateReserve: 1
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(pageTwoAttempts).toBe(2);
    expect(transient.pagination).toEqual(expect.objectContaining({ requestAttempts: 3, pagesRetried: 1, pagesFailed: 1 }));
    expect(transient.pages[1]).toEqual(expect.objectContaining({
      page: 2,
      ok: false,
      attemptCount: 2,
      error: "timeout-2"
    }));
  });

  it("does not spend the configured reserve on a transient retry", async () => {
    const requestedPages: number[] = [];
    const result = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      concurrency: 1,
      requestsReserve: 10,
      rateReserve: 1,
      fetchImpl: async (input) => {
        const page = Number(new URL(String(input)).searchParams.get("page"));
        requestedPages.push(page);
        if (page === 1) return jsonPage({ current: 1, total: 2, rows: [], requestsRemaining: 11, rateRemaining: 100 });
        return new Response("temporary failure", { status: 503 });
      }
    });

    expect(requestedPages).toEqual([1, 2]);
    expect(result.pagination).toEqual(expect.objectContaining({
      requestAttempts: 2,
      pagesRetried: 0,
      pagesFailed: 1,
      stoppedByQuota: true
    }));
    expect(result.pages[1]).toEqual(expect.objectContaining({ page: 2, attemptCount: 1, retried: false }));
  });

  it("keeps the first page and stops when successful quota telemetry is absent", async () => {
    const requestedPages: number[] = [];
    const result = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      maxPages: 10,
      fetchImpl: async (input) => {
        const page = Number(new URL(String(input)).searchParams.get("page"));
        requestedPages.push(page);
        return new Response(JSON.stringify({ paging: { current: page, total: 10 }, response: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
    });

    expect(requestedPages).toEqual([1]);
    expect(result.pagination).toEqual(expect.objectContaining({
      pagesRequested: 1,
      pagesSkipped: 9,
      stoppedByQuota: true,
      complete: false
    }));
  });

  it("never requests beyond the explicit page cap when the provider reports a large slate", async () => {
    const requestedPages: number[] = [];
    const result = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      maxPages: 3,
      concurrency: 3,
      requestsReserve: 0,
      rateReserve: 0,
      fetchImpl: async (input) => {
        const page = Number(new URL(String(input)).searchParams.get("page"));
        requestedPages.push(page);
        return jsonPage({ current: page, total: 100, rows: [], requestsRemaining: 7000, rateRemaining: 250 });
      }
    });

    expect(requestedPages).toEqual([1, 2, 3]);
    expect(result.pagination).toEqual(expect.objectContaining({
      providerTotalPages: 100,
      maxPages: 3,
      pagesRequested: 3,
      pagesSkipped: 97,
      cappedByMaxPages: true,
      stoppedByQuota: false,
      complete: false
    }));
  });

  it("surfaces provider and malformed-pagination failures without inventing markets", async () => {
    const providerFailure = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      fetchImpl: async () => jsonPage({
        current: 1,
        total: 1,
        rows: [],
        status: 429,
        requestsRemaining: 0,
        errors: { requests: "Daily request limit reached" }
      })
    });
    expect(providerFailure.fixtures).toEqual([]);
    expect(providerFailure.pagination).toEqual(expect.objectContaining({ pagesRequested: 1, pagesFailed: 1, stoppedByQuota: true, complete: false }));
    expect(providerFailure.pages[0]).toEqual(expect.objectContaining({
      ok: false,
      httpStatus: 429,
      error: "requests: Daily request limit reached"
    }));
    expect(providerFailure.quota.requestsRemaining).toBe(0);

    const malformed = await fetchApiFootballMatchWinnerOdds({
      date: "2026-07-18",
      apiKey: "key",
      fetchImpl: async () => new Response(JSON.stringify({ response: [] }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    });
    expect(malformed.fixtures).toEqual([]);
    expect(malformed.pages[0]?.error).toContain("malformed odds pagination");
  });
});
