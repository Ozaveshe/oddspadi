import { buildBestExecutableQuote, type ExecutableOddsQuote } from "@/lib/sports/executableOdds";
import { buildNoVigBookmakerConsensus } from "@/lib/sports/oddsConsensus";
import type { OddsMarket } from "@/lib/sports/types";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type JsonRecord = Record<string, unknown>;

export const API_FOOTBALL_ODDS_PAGE_SIZE = 10;
export const API_FOOTBALL_ODDS_DEFAULT_MAX_PAGES = 20;
export const API_FOOTBALL_ODDS_HARD_MAX_PAGES = 50;
export const API_FOOTBALL_ODDS_DEFAULT_CONCURRENCY = 3;
export const API_FOOTBALL_ODDS_HARD_MAX_CONCURRENCY = 5;

export type ApiFootballOddsQuotaSnapshot = {
  requestsLimit: number | null;
  requestsRemaining: number | null;
  rateLimit: number | null;
  rateRemaining: number | null;
};

export type ApiFootballOddsPageAttemptDiagnostic = {
  page: number;
  attempt: number;
  ok: boolean;
  httpStatus: number | null;
  rowsReceived: number;
  quota: ApiFootballOddsQuotaSnapshot;
  error: string | null;
};

export type ApiFootballOddsPageDiagnostic = {
  page: number;
  ok: boolean;
  httpStatus: number | null;
  providerCurrentPage: number | null;
  providerTotalPages: number | null;
  rowsReceived: number;
  quota: ApiFootballOddsQuotaSnapshot;
  error: string | null;
  attemptCount: number;
  retried: boolean;
  attempts: ApiFootballOddsPageAttemptDiagnostic[];
};

export type ApiFootballOddsSourceBookmaker = {
  /** Exact API-Football bookmaker identifier, without a product namespace. */
  providerBookmakerId: string;
  /** Collision-safe identifier used in OddsPadi's shared odds model. */
  bookmakerId: string;
  name: string;
  providerUpdatedAt: string;
};

export type ApiFootballMatchWinnerOdds = {
  /** Exact API-Football fixture identifier, represented losslessly as text. */
  providerFixtureId: string;
  /** Newest provider `update` value used by this normalized fixture. */
  providerUpdatedAt: string;
  oddsMarkets: OddsMarket[];
  sourceBookmakers: ApiFootballOddsSourceBookmaker[];
};

export type ApiFootballOddsFetchResult = {
  fixtures: ApiFootballMatchWinnerOdds[];
  quota: ApiFootballOddsQuotaSnapshot;
  pagination: {
    pageSize: typeof API_FOOTBALL_ODDS_PAGE_SIZE;
    providerTotalPages: number;
    maxPages: number;
    concurrency: number;
    pagesRequested: number;
    pagesSucceeded: number;
    pagesFailed: number;
    requestAttempts: number;
    pagesRetried: number;
    pagesSkipped: number;
    cappedByMaxPages: boolean;
    stoppedByQuota: boolean;
    complete: boolean;
  };
  normalization: {
    rowsReceived: number;
    rowsRejected: number;
    bookmakerQuotesAccepted: number;
    bookmakerQuotesRejected: number;
    fixturesAccepted: number;
  };
  pages: ApiFootballOddsPageDiagnostic[];
};

export type FetchApiFootballOddsOptions = {
  date: string;
  apiKey: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  maxPages?: number;
  concurrency?: number;
  /** Minimum daily request balance retained after this bounded read. */
  requestsReserve?: number;
  /** Minimum per-minute request balance retained after this bounded read. */
  rateReserve?: number;
  signal?: AbortSignal;
};

type NormalizedQuote = ExecutableOddsQuote & {
  providerBookmakerId: string;
  bookmaker: NonNullable<OddsMarket["bookmaker"]>;
  observedAt: string;
};

type NormalizedRow = {
  fixtureId: string;
  providerUpdatedAt: string;
  quotes: NormalizedQuote[];
  bookmakerCandidates: number;
};

type ParsedPage = {
  page: number;
  ok: boolean;
  httpStatus: number | null;
  currentPage: number | null;
  totalPages: number | null;
  rows: unknown[];
  quota: ApiFootballOddsQuotaSnapshot;
  error: string | null;
};

type ParsedPageRecord = {
  final: ParsedPage;
  attempts: ParsedPage[];
};

const EMPTY_QUOTA: ApiFootballOddsQuotaSnapshot = {
  requestsLimit: null,
  requestsRemaining: null,
  rateLimit: null,
  rateRemaining: null
};

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function providerId(value: unknown): string | null {
  if (typeof value === "string") {
    const cleaned = text(value);
    return cleaned && /^\d+$/.test(cleaned) && /[1-9]/.test(cleaned) ? cleaned : null;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  return null;
}

function positiveInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function boundedInteger(value: number | undefined, fallback: number, hardMaximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(hardMaximum, Math.max(1, Math.floor(value!)));
}

function boundedReserve(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value!));
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validProviderTimestamp(value: unknown): string | null {
  const cleaned = text(value);
  return cleaned && Number.isFinite(Date.parse(cleaned)) ? cleaned : null;
}

function finiteHeader(headers: Headers, names: string[]): number | null {
  for (const name of names) {
    const value = headers.get(name);
    if (value === null || !value.trim()) continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return null;
}

function quotaFromHeaders(headers: Headers): ApiFootballOddsQuotaSnapshot {
  return {
    requestsLimit: finiteHeader(headers, ["x-ratelimit-requests-limit", "x-requests-limit"]),
    requestsRemaining: finiteHeader(headers, ["x-ratelimit-requests-remaining", "x-requests-remaining"]),
    rateLimit: finiteHeader(headers, ["x-ratelimit-limit"]),
    rateRemaining: finiteHeader(headers, ["x-ratelimit-remaining"])
  };
}

function conservativeQuota(snapshots: ApiFootballOddsQuotaSnapshot[]): ApiFootballOddsQuotaSnapshot {
  const minimum = (values: Array<number | null>) => {
    const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
    return finite.length ? Math.min(...finite) : null;
  };
  return {
    requestsLimit: minimum(snapshots.map((item) => item.requestsLimit)),
    requestsRemaining: minimum(snapshots.map((item) => item.requestsRemaining)),
    rateLimit: minimum(snapshots.map((item) => item.rateLimit)),
    rateRemaining: minimum(snapshots.map((item) => item.rateRemaining))
  };
}

function providerErrors(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => text(item)).filter((item): item is string => Boolean(item));
  const item = record(value);
  if (!item) return text(value) ? [text(value)!] : [];
  return Object.entries(item).flatMap(([key, detail]) => {
    const message = text(detail);
    return message ? [`${key}: ${message}`] : [];
  });
}

function safeResponseMessage(body: unknown, status: number): string {
  const item = record(body);
  const errors = providerErrors(item?.errors);
  if (errors.length) return errors.join("; ");
  const message = text(item?.message);
  return message ?? `API-Football returned HTTP ${status}.`;
}

async function fetchPage({
  page,
  date,
  apiKey,
  baseUrl,
  fetchImpl,
  signal
}: {
  page: number;
  date: string;
  apiKey: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  signal?: AbortSignal;
}): Promise<ParsedPage> {
  const endpoint = new URL("/odds", baseUrl);
  endpoint.searchParams.set("date", date);
  endpoint.searchParams.set("bet", "1");
  endpoint.searchParams.set("page", String(page));

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { accept: "application/json", "x-apisports-key": apiKey },
      signal
    });
  } catch (error) {
    return {
      page,
      ok: false,
      httpStatus: null,
      currentPage: null,
      totalPages: null,
      rows: [],
      quota: { ...EMPTY_QUOTA },
      error: error instanceof Error ? error.message : "API-Football odds request failed."
    };
  }

  const quota = quotaFromHeaders(response.headers);
  const contentType = response.headers.get("content-type") ?? "";
  const body = contentType.toLowerCase().includes("application/json")
    ? await response.json().catch(() => null)
    : await response.text().catch(() => "");
  const item = record(body);
  const errors = providerErrors(item?.errors);
  if (!response.ok || errors.length) {
    return {
      page,
      ok: false,
      httpStatus: response.status,
      currentPage: null,
      totalPages: null,
      rows: [],
      quota,
      error: safeResponseMessage(body, response.status)
    };
  }

  const paging = record(item?.paging);
  const currentPage = positiveInteger(paging?.current);
  const totalPages = positiveInteger(paging?.total);
  const rows = Array.isArray(item?.response) ? item.response : null;
  if (!item || !rows || currentPage !== page || totalPages === null) {
    return {
      page,
      ok: false,
      httpStatus: response.status,
      currentPage,
      totalPages,
      rows: [],
      quota,
      error: "API-Football returned malformed odds pagination or response rows."
    };
  }

  return { page, ok: true, httpStatus: response.status, currentPage, totalPages, rows, quota, error: null };
}

function decimalOdd(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function isSuspended(value: unknown): boolean {
  if (value === true || value === 1) return true;
  const cleaned = text(value)?.toLowerCase();
  return cleaned === "true" || cleaned === "1" || cleaned === "yes";
}

function matchWinnerSelection(value: unknown): "home" | "draw" | "away" | null {
  const cleaned = text(value)?.toLowerCase();
  return cleaned === "home" || cleaned === "draw" || cleaned === "away" ? cleaned : null;
}

function quoteMargin(quote: NormalizedQuote): number {
  return quote.selections.reduce((sum, selection) => sum + 1 / selection.decimalOdds, 0) - 1;
}

function bookmakerQuote(bookmakerValue: unknown, providerUpdatedAt: string): NormalizedQuote | null {
  const bookmaker = record(bookmakerValue);
  const providerBookmakerId = providerId(bookmaker?.id);
  const name = text(bookmaker?.name);
  if (!bookmaker || providerBookmakerId === null || !name || !Array.isArray(bookmaker.bets)) return null;

  const winnerBet = bookmaker.bets
    .map(record)
    .find((bet) => providerId(bet?.id) === "1");
  if (!winnerBet || !Array.isArray(winnerBet.values)) return null;

  const prices = new Map<"home" | "draw" | "away", number>();
  for (const value of winnerBet.values) {
    const item = record(value);
    const selection = matchWinnerSelection(item?.value);
    const odd = decimalOdd(item?.odd);
    if (!item || !selection || odd === null || isSuspended(item.suspended)) continue;
    prices.set(selection, Math.max(prices.get(selection) ?? 0, odd));
  }
  const home = prices.get("home");
  const draw = prices.get("draw");
  const away = prices.get("away");
  if (!home || !draw || !away) return null;

  const normalizedBookmaker = {
    id: `api-football-bookmaker:${providerBookmakerId}`,
    name
  };
  return {
    providerBookmakerId,
    bookmaker: normalizedBookmaker,
    observedAt: providerUpdatedAt,
    selections: [
      { id: "home", label: "Home", decimalOdds: home },
      { id: "draw", label: "Draw", decimalOdds: draw },
      { id: "away", label: "Away", decimalOdds: away }
    ]
  };
}

function normalizeRow(value: unknown): NormalizedRow | null {
  const item = record(value);
  const fixture = record(item?.fixture);
  const fixtureId = providerId(fixture?.id);
  const providerUpdatedAt = validProviderTimestamp(item?.update);
  if (!item || fixtureId === null || !providerUpdatedAt || !Array.isArray(item.bookmakers)) return null;

  const candidates = item.bookmakers.length;
  const quotes = item.bookmakers
    .map((bookmaker) => bookmakerQuote(bookmaker, providerUpdatedAt))
    .filter((quote): quote is NormalizedQuote => quote !== null);
  if (!quotes.length) return { fixtureId, providerUpdatedAt, quotes: [], bookmakerCandidates: candidates };
  return { fixtureId, providerUpdatedAt, quotes, bookmakerCandidates: candidates };
}

function timestamp(value: string): number {
  return Date.parse(value);
}

function dedupeBookmakerQuotes(quotes: NormalizedQuote[]): NormalizedQuote[] {
  const byBookmaker = new Map<string, NormalizedQuote>();
  for (const quote of quotes) {
    const current = byBookmaker.get(quote.bookmaker.id);
    if (!current) {
      byBookmaker.set(quote.bookmaker.id, quote);
      continue;
    }
    const timeDelta = timestamp(quote.observedAt) - timestamp(current.observedAt);
    if (timeDelta > 0 || (timeDelta === 0 && Math.abs(quoteMargin(quote)) < Math.abs(quoteMargin(current)))) {
      byBookmaker.set(quote.bookmaker.id, quote);
    }
  }
  return [...byBookmaker.values()].sort((left, right) => left.bookmaker.id.localeCompare(right.bookmaker.id));
}

function fixtureMarkets(rows: NormalizedRow[]): ApiFootballMatchWinnerOdds[] {
  const byFixture = new Map<string, NormalizedRow[]>();
  for (const row of rows) byFixture.set(row.fixtureId, [...(byFixture.get(row.fixtureId) ?? []), row]);

  return [...byFixture.entries()].flatMap(([fixtureId, fixtureRows]) => {
    const quotes = dedupeBookmakerQuotes(fixtureRows.flatMap((row) => row.quotes));
    const executable = buildBestExecutableQuote(quotes);
    if (!executable || executable.selections.length !== 3) return [];
    const providerUpdatedAt = quotes
      .map((quote) => quote.observedAt)
      .sort((left, right) => timestamp(right) - timestamp(left))[0]!;
    const market: OddsMarket = {
      id: "match_winner",
      name: "Match winner",
      selections: executable.selections,
      ...(executable.bookmaker ? { bookmaker: executable.bookmaker } : {}),
      priceMethod: "best-price-per-selection-v1",
      consensus: buildNoVigBookmakerConsensus(quotes)
    };
    return [{
      providerFixtureId: fixtureId,
      providerUpdatedAt,
      oddsMarkets: [market],
      sourceBookmakers: quotes.map((quote) => ({
        providerBookmakerId: quote.providerBookmakerId,
        bookmakerId: quote.bookmaker.id,
        name: quote.bookmaker.name,
        providerUpdatedAt: quote.observedAt
      }))
    }];
  }).sort((left, right) => left.providerFixtureId.localeCompare(right.providerFixtureId));
}

function availableQuotaRequests(quota: ApiFootballOddsQuotaSnapshot, requestsReserve: number, rateReserve: number): number | null {
  const balances = [
    quota.requestsRemaining === null ? null : Math.max(0, Math.floor(quota.requestsRemaining) - requestsReserve),
    quota.rateRemaining === null ? null : Math.max(0, Math.floor(quota.rateRemaining) - rateReserve)
  ].filter((value): value is number => value !== null);
  return balances.length ? Math.min(...balances) : null;
}

function isTransientPageFailure(page: ParsedPage): boolean {
  if (page.ok) return false;
  return page.httpStatus === null
    || page.httpStatus === 408
    || page.httpStatus === 425
    || (page.httpStatus >= 500 && page.httpStatus <= 599);
}

function pageDiagnostic(record: ParsedPageRecord): ApiFootballOddsPageDiagnostic {
  const page = record.final;
  return {
    page: page.page,
    ok: page.ok,
    httpStatus: page.httpStatus,
    providerCurrentPage: page.currentPage,
    providerTotalPages: page.totalPages,
    rowsReceived: page.rows.length,
    quota: page.quota,
    error: page.error,
    attemptCount: record.attempts.length,
    retried: record.attempts.length > 1,
    attempts: record.attempts.map((attempt, index) => ({
      page: attempt.page,
      attempt: index + 1,
      ok: attempt.ok,
      httpStatus: attempt.httpStatus,
      rowsReceived: attempt.rows.length,
      quota: attempt.quota,
      error: attempt.error
    }))
  };
}

/**
 * Fetches and normalizes API-Football's current match-winner odds for one day.
 * The adapter is storage-free and deterministic apart from its injected fetch.
 */
export async function fetchApiFootballMatchWinnerOdds({
  date,
  apiKey,
  fetchImpl = fetch,
  baseUrl = "https://v3.football.api-sports.io",
  maxPages: requestedMaxPages,
  concurrency: requestedConcurrency,
  requestsReserve: requestedRequestsReserve,
  rateReserve: requestedRateReserve,
  signal
}: FetchApiFootballOddsOptions): Promise<ApiFootballOddsFetchResult> {
  if (!validDate(date)) throw new TypeError("API-Football odds date must be a real YYYY-MM-DD calendar date.");
  const cleanedKey = apiKey.trim();
  if (!cleanedKey) throw new TypeError("API-Football odds requires a non-empty API key.");

  const maxPages = boundedInteger(requestedMaxPages, API_FOOTBALL_ODDS_DEFAULT_MAX_PAGES, API_FOOTBALL_ODDS_HARD_MAX_PAGES);
  const concurrency = boundedInteger(requestedConcurrency, API_FOOTBALL_ODDS_DEFAULT_CONCURRENCY, API_FOOTBALL_ODDS_HARD_MAX_CONCURRENCY);
  const requestsReserve = boundedReserve(requestedRequestsReserve, 10);
  const rateReserve = boundedReserve(requestedRateReserve, 1);
  const shared = { date, apiKey: cleanedKey, baseUrl, fetchImpl, signal };

  const firstAttempts = [await fetchPage({ ...shared, page: 1 })];
  let first = firstAttempts[0]!;
  let localQuotaAllowance = availableQuotaRequests(first.quota, requestsReserve, rateReserve);
  let stoppedByQuota = first.httpStatus === 429;
  if (isTransientPageFailure(first)) {
    if (localQuotaAllowance !== null && localQuotaAllowance > 0) {
      localQuotaAllowance -= 1;
      first = await fetchPage({ ...shared, page: 1 });
      firstAttempts.push(first);
      const reportedAllowance = availableQuotaRequests(
        conservativeQuota(firstAttempts.map((attempt) => attempt.quota)),
        requestsReserve,
        rateReserve
      );
      if (reportedAllowance !== null) localQuotaAllowance = Math.min(localQuotaAllowance, reportedAllowance);
      if (first.httpStatus === 429) stoppedByQuota = true;
    } else {
      // A retry is still a provider request. Without proved headroom, preserve
      // the configured reserve instead of retrying blindly.
      stoppedByQuota = true;
    }
  }

  const pages: ParsedPageRecord[] = [{ final: first, attempts: firstAttempts }];
  const allAttempts: ParsedPage[] = [...firstAttempts];
  const providerTotalPages = first.totalPages ?? 1;
  const plannedTotal = Math.min(providerTotalPages, maxPages);
  const remainingPages = Array.from({ length: Math.max(0, plannedTotal - 1) }, (_, index) => index + 2);
  // Without a provider balance we cannot prove that another request preserves
  // the configured reserve. Keep the useful first page and stop safely.
  if (first.ok && remainingPages.length > 0 && localQuotaAllowance === null) stoppedByQuota = true;

  while (first.ok && !stoppedByQuota && remainingPages.length) {
    if (localQuotaAllowance !== null && localQuotaAllowance <= 0) {
      stoppedByQuota = true;
      break;
    }
    const batchSize = Math.min(concurrency, remainingPages.length, localQuotaAllowance ?? Number.POSITIVE_INFINITY);
    const batch = remainingPages.splice(0, batchSize);
    // Spend locally before dispatch. If a failed/timeout response has no quota
    // headers, the last known provider balance must still move pessimistically.
    if (localQuotaAllowance !== null) localQuotaAllowance -= batch.length;
    const results = await Promise.all(batch.map((page) => fetchPage({ ...shared, page })));
    allAttempts.push(...results);
    let reportedAllowance = availableQuotaRequests(conservativeQuota(allAttempts.map((page) => page.quota)), requestsReserve, rateReserve);
    if (reportedAllowance !== null) {
      localQuotaAllowance = localQuotaAllowance === null ? reportedAllowance : Math.min(localQuotaAllowance, reportedAllowance);
    }

    const transientFailures = results.filter(isTransientPageFailure);
    const retryCapacity = localQuotaAllowance === null
      ? 0
      : Math.min(transientFailures.length, Math.max(0, localQuotaAllowance));
    const retryPages = transientFailures.slice(0, retryCapacity).map((page) => page.page);
    const retryResults = new Map<number, ParsedPage>();
    if (retryPages.length) {
      localQuotaAllowance! -= retryPages.length;
      const retried = await Promise.all(retryPages.map((page) => fetchPage({ ...shared, page })));
      retried.forEach((page) => retryResults.set(page.page, page));
      allAttempts.push(...retried);
      reportedAllowance = availableQuotaRequests(conservativeQuota(allAttempts.map((page) => page.quota)), requestsReserve, rateReserve);
      if (reportedAllowance !== null) localQuotaAllowance = Math.min(localQuotaAllowance!, reportedAllowance);
    }
    if (retryCapacity < transientFailures.length) stoppedByQuota = true;

    pages.push(...results.map((page) => {
      const retry = retryResults.get(page.page);
      return { final: retry ?? page, attempts: retry ? [page, retry] : [page] };
    }));
    if (results.some((page) => page.httpStatus === 429) || [...retryResults.values()].some((page) => page.httpStatus === 429)) {
      stoppedByQuota = true;
      break;
    }
  }

  const successful = pages.filter((page) => page.final.ok);
  const rawRows = successful.flatMap((page) => page.final.rows);
  const normalizedRows = rawRows.map(normalizeRow);
  const acceptedRows = normalizedRows.filter((row): row is NormalizedRow => row !== null);
  const bookmakerCandidates = acceptedRows.reduce((sum, row) => sum + row.bookmakerCandidates, 0);
  const bookmakerQuotesAccepted = acceptedRows.reduce((sum, row) => sum + row.quotes.length, 0);
  const fixtures = fixtureMarkets(acceptedRows);
  const pagesRequested = pages.length;
  const pagesSucceeded = successful.length;
  const pagesFailed = pagesRequested - pagesSucceeded;
  const requestAttempts = allAttempts.length;
  const pagesRetried = pages.filter((page) => page.attempts.length > 1).length;
  const cappedByMaxPages = providerTotalPages > maxPages;
  const pagesSkipped = Math.max(0, providerTotalPages - pagesRequested);

  return {
    fixtures,
    quota: conservativeQuota(allAttempts.map((page) => page.quota)),
    pagination: {
      pageSize: API_FOOTBALL_ODDS_PAGE_SIZE,
      providerTotalPages,
      maxPages,
      concurrency,
      pagesRequested,
      pagesSucceeded,
      pagesFailed,
      requestAttempts,
      pagesRetried,
      pagesSkipped,
      cappedByMaxPages,
      stoppedByQuota,
      complete: first.ok && pagesFailed === 0 && pagesRequested === providerTotalPages && !cappedByMaxPages && !stoppedByQuota
    },
    normalization: {
      rowsReceived: rawRows.length,
      rowsRejected: normalizedRows.filter((row) => row === null || row.quotes.length === 0).length,
      bookmakerQuotesAccepted,
      bookmakerQuotesRejected: Math.max(0, bookmakerCandidates - bookmakerQuotesAccepted),
      fixturesAccepted: fixtures.length
    },
    pages: pages.map(pageDiagnostic).sort((left, right) => left.page - right.page)
  };
}
