import { buildBestExecutableQuote, type ExecutableOddsQuote } from "@/lib/sports/executableOdds";
import { buildNoVigBookmakerConsensus } from "@/lib/sports/oddsConsensus";
import type { OddsMarket } from "@/lib/sports/types";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

type JsonRecord = Record<string, unknown>;

export const API_BASKETBALL_HOME_AWAY_BET_ID = "2";
export const API_BASKETBALL_ODDS_DEFAULT_MAX_GROUPS = 20;
export const API_BASKETBALL_ODDS_HARD_MAX_GROUPS = 50;
export const API_BASKETBALL_ODDS_DEFAULT_CONCURRENCY = 3;
export const API_BASKETBALL_ODDS_HARD_MAX_CONCURRENCY = 5;

export type ApiBasketballOddsTargetGame = {
  /** Exact API-Basketball game identifier, represented losslessly as text. */
  providerGameId: string;
  /** Exact API-Basketball league identifier, represented losslessly as text. */
  providerLeagueId: string;
  /** Exact provider season, for example `2026` or `2025-2026`. */
  season: string;
};

export type ApiBasketballOddsQuotaSnapshot = {
  requestsLimit: number | null;
  requestsRemaining: number | null;
  rateLimit: number | null;
  rateRemaining: number | null;
};

export type ApiBasketballOddsGroupDiagnostic = {
  providerLeagueId: string;
  season: string;
  targetGames: number;
  ok: boolean;
  httpStatus: number | null;
  rowsReceived: number;
  quota: ApiBasketballOddsQuotaSnapshot;
  error: string | null;
};

export type ApiBasketballOddsSourceBookmaker = {
  /** Exact API-Basketball bookmaker identifier, without a product namespace. */
  providerBookmakerId: string;
  /** Collision-safe identifier used in OddsPadi's shared odds model. */
  bookmakerId: string;
  name: string;
  providerUpdatedAt: string;
};

export type ApiBasketballMoneylineOdds = {
  /** Exact API-Basketball game identifier, represented losslessly as text. */
  providerGameId: string;
  providerLeagueId: string;
  season: string;
  /** Newest explicit provider `update` value used by this normalized game. */
  providerUpdatedAt: string;
  oddsMarkets: OddsMarket[];
  sourceBookmakers: ApiBasketballOddsSourceBookmaker[];
};

export type ApiBasketballOddsFetchResult = {
  games: ApiBasketballMoneylineOdds[];
  quota: ApiBasketballOddsQuotaSnapshot;
  requests: {
    providerGroups: number;
    maxGroups: number;
    concurrency: number;
    groupsRequested: number;
    groupsSucceeded: number;
    groupsFailed: number;
    groupsSkipped: number;
    cappedByMaxGroups: boolean;
    stoppedByQuota: boolean;
    complete: boolean;
  };
  normalization: {
    targetGames: number;
    rowsReceived: number;
    rowsRejected: number;
    bookmakerQuotesAccepted: number;
    bookmakerQuotesRejected: number;
    gamesAccepted: number;
  };
  groups: ApiBasketballOddsGroupDiagnostic[];
};

export type FetchApiBasketballOddsOptions = {
  targetGames: ApiBasketballOddsTargetGame[];
  apiKey: string;
  fetchImpl?: FetchLike;
  baseUrl?: string;
  maxGroups?: number;
  concurrency?: number;
  /** Minimum daily request balance retained after this bounded read. */
  requestsReserve?: number;
  /** Minimum per-minute request balance retained after this bounded read. */
  rateReserve?: number;
  signal?: AbortSignal;
};

type TargetGroup = {
  providerLeagueId: string;
  season: string;
  targetGameIds: Set<string>;
};

type NormalizedQuote = ExecutableOddsQuote & {
  providerBookmakerId: string;
  bookmaker: NonNullable<OddsMarket["bookmaker"]>;
  observedAt: string;
};

type NormalizedRow = {
  gameId: string;
  providerLeagueId: string;
  season: string;
  providerUpdatedAt: string;
  quotes: NormalizedQuote[];
  bookmakerCandidates: number;
};

type ParsedGroup = TargetGroup & {
  ok: boolean;
  httpStatus: number | null;
  rows: unknown[];
  quota: ApiBasketballOddsQuotaSnapshot;
  error: string | null;
};

const EMPTY_QUOTA: ApiBasketballOddsQuotaSnapshot = {
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

function providerSeason(value: unknown): string | null {
  const cleaned = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : text(value);
  if (!cleaned || !/^\d{4}(?:-\d{4})?$/.test(cleaned)) return null;
  return cleaned;
}

function boundedInteger(value: number | undefined, fallback: number, hardMaximum: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(hardMaximum, Math.max(1, Math.floor(value!)));
}

function boundedReserve(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value!));
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

function quotaFromHeaders(headers: Headers): ApiBasketballOddsQuotaSnapshot {
  return {
    requestsLimit: finiteHeader(headers, ["x-ratelimit-requests-limit", "x-requests-limit"]),
    requestsRemaining: finiteHeader(headers, ["x-ratelimit-requests-remaining", "x-requests-remaining"]),
    rateLimit: finiteHeader(headers, ["x-ratelimit-limit"]),
    rateRemaining: finiteHeader(headers, ["x-ratelimit-remaining"])
  };
}

function conservativeQuota(snapshots: ApiBasketballOddsQuotaSnapshot[]): ApiBasketballOddsQuotaSnapshot {
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
  return message ?? `API-Basketball returned HTTP ${status}.`;
}

function quotaFailure(group: ParsedGroup): boolean {
  return group.httpStatus === 429 || Boolean(group.error && /(?:quota|rate|request).*(?:limit|exhaust|remaining)|daily request limit/i.test(group.error));
}

function normalizeTargets(targetGames: ApiBasketballOddsTargetGame[]): TargetGroup[] {
  const gameAssignments = new Map<string, string>();
  const groups = new Map<string, TargetGroup>();

  for (const [index, target] of targetGames.entries()) {
    const providerGameId = providerId(target?.providerGameId);
    const providerLeagueId = providerId(target?.providerLeagueId);
    const season = providerSeason(target?.season);
    if (!providerGameId || !providerLeagueId || !season) {
      throw new TypeError(`API-Basketball target game at index ${index} requires positive numeric game/league IDs and a valid provider season.`);
    }
    const groupKey = `${providerLeagueId}:${season}`;
    const assignedGroup = gameAssignments.get(providerGameId);
    if (assignedGroup && assignedGroup !== groupKey) {
      throw new TypeError(`API-Basketball game ${providerGameId} was assigned to conflicting league/season groups.`);
    }
    gameAssignments.set(providerGameId, groupKey);
    const group = groups.get(groupKey) ?? { providerLeagueId, season, targetGameIds: new Set<string>() };
    group.targetGameIds.add(providerGameId);
    groups.set(groupKey, group);
  }

  return [...groups.values()].sort((left, right) => {
    const leagueDelta = Number(left.providerLeagueId) - Number(right.providerLeagueId);
    return leagueDelta || left.season.localeCompare(right.season);
  });
}

async function fetchGroup({
  group,
  apiKey,
  baseUrl,
  fetchImpl,
  signal
}: {
  group: TargetGroup;
  apiKey: string;
  baseUrl: string;
  fetchImpl: FetchLike;
  signal?: AbortSignal;
}): Promise<ParsedGroup> {
  const endpoint = new URL("/odds", baseUrl);
  endpoint.searchParams.set("league", group.providerLeagueId);
  endpoint.searchParams.set("season", group.season);
  endpoint.searchParams.set("bet", API_BASKETBALL_HOME_AWAY_BET_ID);

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      headers: { accept: "application/json", "x-apisports-key": apiKey },
      signal
    });
  } catch (error) {
    return {
      ...group,
      ok: false,
      httpStatus: null,
      rows: [],
      quota: { ...EMPTY_QUOTA },
      error: error instanceof Error ? error.message : "API-Basketball odds request failed."
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
      ...group,
      ok: false,
      httpStatus: response.status,
      rows: [],
      quota,
      error: safeResponseMessage(body, response.status)
    };
  }

  const rows = Array.isArray(item?.response) ? item.response : null;
  if (!item || !rows) {
    return {
      ...group,
      ok: false,
      httpStatus: response.status,
      rows: [],
      quota,
      error: "API-Basketball returned malformed odds response rows."
    };
  }

  return { ...group, ok: true, httpStatus: response.status, rows, quota, error: null };
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

function moneylineSelection(value: unknown): "home" | "away" | null {
  const cleaned = text(value)?.toLowerCase();
  return cleaned === "home" || cleaned === "away" ? cleaned : null;
}

function quoteMargin(quote: NormalizedQuote): number {
  return quote.selections.reduce((sum, selection) => sum + 1 / selection.decimalOdds, 0) - 1;
}

function bookmakerQuote(bookmakerValue: unknown, providerUpdatedAt: string): NormalizedQuote | null {
  const bookmaker = record(bookmakerValue);
  const providerBookmakerId = providerId(bookmaker?.id);
  const name = text(bookmaker?.name);
  if (!bookmaker || providerBookmakerId === null || !name || !Array.isArray(bookmaker.bets)) return null;

  const homeAwayBet = bookmaker.bets
    .map(record)
    .find((bet) => providerId(bet?.id) === API_BASKETBALL_HOME_AWAY_BET_ID && text(bet?.name)?.toLowerCase() === "home/away");
  if (!homeAwayBet || !Array.isArray(homeAwayBet.values)) return null;

  const prices = new Map<"home" | "away", number>();
  for (const value of homeAwayBet.values) {
    const item = record(value);
    const selection = moneylineSelection(item?.value);
    const odd = decimalOdd(item?.odd);
    if (!item || !selection || odd === null || isSuspended(item.suspended)) continue;
    prices.set(selection, Math.max(prices.get(selection) ?? 0, odd));
  }
  const home = prices.get("home");
  const away = prices.get("away");
  if (!home || !away) return null;

  const normalizedBookmaker = {
    id: `api-basketball-bookmaker:${providerBookmakerId}`,
    name
  };
  return {
    providerBookmakerId,
    bookmaker: normalizedBookmaker,
    observedAt: providerUpdatedAt,
    selections: [
      { id: "home", label: "Home", decimalOdds: home },
      { id: "away", label: "Away", decimalOdds: away }
    ]
  };
}

function normalizeRow(value: unknown, group: TargetGroup): NormalizedRow | null {
  const item = record(value);
  const game = record(item?.game);
  const league = record(item?.league);
  const gameId = providerId(game?.id);
  const providerLeagueId = providerId(league?.id);
  const season = providerSeason(league?.season);
  const providerUpdatedAt = validProviderTimestamp(item?.update);
  if (
    !item ||
    !gameId ||
    !group.targetGameIds.has(gameId) ||
    providerLeagueId !== group.providerLeagueId ||
    season !== group.season ||
    !providerUpdatedAt ||
    !Array.isArray(item.bookmakers)
  ) return null;

  const bookmakerCandidates = item.bookmakers.length;
  const quotes = item.bookmakers
    .map((bookmaker) => bookmakerQuote(bookmaker, providerUpdatedAt))
    .filter((quote): quote is NormalizedQuote => quote !== null);
  return { gameId, providerLeagueId, season, providerUpdatedAt, quotes, bookmakerCandidates };
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

function gameMarkets(rows: NormalizedRow[]): ApiBasketballMoneylineOdds[] {
  const byGame = new Map<string, NormalizedRow[]>();
  for (const row of rows) byGame.set(row.gameId, [...(byGame.get(row.gameId) ?? []), row]);

  return [...byGame.entries()].flatMap(([gameId, gameRows]) => {
    const quotes = dedupeBookmakerQuotes(gameRows.flatMap((row) => row.quotes));
    const executable = buildBestExecutableQuote(quotes);
    if (!executable || executable.selections.length !== 2) return [];
    const newestRow = gameRows
      .slice()
      .sort((left, right) => timestamp(right.providerUpdatedAt) - timestamp(left.providerUpdatedAt))[0]!;
    const providerUpdatedAt = quotes
      .map((quote) => quote.observedAt)
      .sort((left, right) => timestamp(right) - timestamp(left))[0]!;
    const market: OddsMarket = {
      id: "match_winner",
      name: "Moneyline",
      selections: executable.selections,
      ...(executable.bookmaker ? { bookmaker: executable.bookmaker } : {}),
      priceMethod: "best-price-per-selection-v1",
      consensus: buildNoVigBookmakerConsensus(quotes)
    };
    return [{
      providerGameId: gameId,
      providerLeagueId: newestRow.providerLeagueId,
      season: newestRow.season,
      providerUpdatedAt,
      oddsMarkets: [market],
      sourceBookmakers: quotes.map((quote) => ({
        providerBookmakerId: quote.providerBookmakerId,
        bookmakerId: quote.bookmaker.id,
        name: quote.bookmaker.name,
        providerUpdatedAt: quote.observedAt
      }))
    }];
  }).sort((left, right) => left.providerGameId.localeCompare(right.providerGameId));
}

function availableQuotaRequests(quota: ApiBasketballOddsQuotaSnapshot, requestsReserve: number, rateReserve: number): number | null {
  const balances = [
    quota.requestsRemaining === null ? null : Math.max(0, Math.floor(quota.requestsRemaining) - requestsReserve),
    quota.rateRemaining === null ? null : Math.max(0, Math.floor(quota.rateRemaining) - rateReserve)
  ].filter((value): value is number => value !== null);
  return balances.length ? Math.min(...balances) : null;
}

function groupDiagnostic(group: ParsedGroup): ApiBasketballOddsGroupDiagnostic {
  return {
    providerLeagueId: group.providerLeagueId,
    season: group.season,
    targetGames: group.targetGameIds.size,
    ok: group.ok,
    httpStatus: group.httpStatus,
    rowsReceived: group.rows.length,
    quota: group.quota,
    error: group.error
  };
}

function emptyResult({
  maxGroups,
  concurrency,
  targetGames
}: {
  maxGroups: number;
  concurrency: number;
  targetGames: number;
}): ApiBasketballOddsFetchResult {
  return {
    games: [],
    quota: { ...EMPTY_QUOTA },
    requests: {
      providerGroups: 0,
      maxGroups,
      concurrency,
      groupsRequested: 0,
      groupsSucceeded: 0,
      groupsFailed: 0,
      groupsSkipped: 0,
      cappedByMaxGroups: false,
      stoppedByQuota: false,
      complete: true
    },
    normalization: {
      targetGames,
      rowsReceived: 0,
      rowsRejected: 0,
      bookmakerQuotesAccepted: 0,
      bookmakerQuotesRejected: 0,
      gamesAccepted: 0
    },
    groups: []
  };
}

/**
 * Fetches and normalizes API-Basketball's documented Home/Away (bet 2) odds.
 * Requests are grouped by the exact league/season pairs already present on the
 * fixture slate. Rows are joined only by exact game ID and must carry an
 * explicit provider `update` timestamp; HTTP/request time is never freshness.
 * The adapter is storage-free and deterministic apart from its injected fetch.
 */
export async function fetchApiBasketballMoneylineOdds({
  targetGames,
  apiKey,
  fetchImpl = fetch,
  baseUrl = "https://v1.basketball.api-sports.io",
  maxGroups: requestedMaxGroups,
  concurrency: requestedConcurrency,
  requestsReserve: requestedRequestsReserve,
  rateReserve: requestedRateReserve,
  signal
}: FetchApiBasketballOddsOptions): Promise<ApiBasketballOddsFetchResult> {
  const cleanedKey = apiKey.trim();
  if (!cleanedKey) throw new TypeError("API-Basketball odds requires a non-empty API key.");
  if (!Array.isArray(targetGames)) throw new TypeError("API-Basketball odds requires a target-games array.");

  const maxGroups = boundedInteger(requestedMaxGroups, API_BASKETBALL_ODDS_DEFAULT_MAX_GROUPS, API_BASKETBALL_ODDS_HARD_MAX_GROUPS);
  const concurrency = boundedInteger(requestedConcurrency, API_BASKETBALL_ODDS_DEFAULT_CONCURRENCY, API_BASKETBALL_ODDS_HARD_MAX_CONCURRENCY);
  const requestsReserve = boundedReserve(requestedRequestsReserve, 10);
  const rateReserve = boundedReserve(requestedRateReserve, 1);
  const allGroups = normalizeTargets(targetGames);
  if (!allGroups.length) return emptyResult({ maxGroups, concurrency, targetGames: targetGames.length });

  const plannedGroups = allGroups.slice(0, maxGroups);
  const pendingGroups = plannedGroups.slice(1);
  const shared = { apiKey: cleanedKey, baseUrl, fetchImpl, signal };
  const groups: ParsedGroup[] = [await fetchGroup({ ...shared, group: plannedGroups[0]! })];
  const first = groups[0]!;
  let stoppedByQuota = quotaFailure(first);
  let localQuotaAllowance = availableQuotaRequests(first.quota, requestsReserve, rateReserve);
  // Without a provider balance we cannot prove another group request preserves
  // the configured reserve. Keep the first response and stop safely.
  if (first.ok && pendingGroups.length > 0 && localQuotaAllowance === null) stoppedByQuota = true;

  while (first.ok && !stoppedByQuota && pendingGroups.length) {
    if (localQuotaAllowance !== null && localQuotaAllowance <= 0) {
      stoppedByQuota = true;
      break;
    }
    const batchSize = Math.min(concurrency, pendingGroups.length, localQuotaAllowance ?? Number.POSITIVE_INFINITY);
    const batch = pendingGroups.splice(0, batchSize);
    if (localQuotaAllowance !== null) localQuotaAllowance -= batch.length;
    const results = await Promise.all(batch.map((group) => fetchGroup({ ...shared, group })));
    groups.push(...results);
    const reportedAllowance = availableQuotaRequests(conservativeQuota(groups.map((group) => group.quota)), requestsReserve, rateReserve);
    if (reportedAllowance !== null) {
      localQuotaAllowance = localQuotaAllowance === null ? reportedAllowance : Math.min(localQuotaAllowance, reportedAllowance);
    }
    if (results.some(quotaFailure)) {
      stoppedByQuota = true;
      break;
    }
  }

  const successful = groups.filter((group) => group.ok);
  const normalizedRows = successful.flatMap((group) => group.rows.map((row) => normalizeRow(row, group)));
  const acceptedRows = normalizedRows.filter((row): row is NormalizedRow => row !== null);
  const bookmakerCandidates = acceptedRows.reduce((sum, row) => sum + row.bookmakerCandidates, 0);
  const bookmakerQuotesAccepted = acceptedRows.reduce((sum, row) => sum + row.quotes.length, 0);
  const games = gameMarkets(acceptedRows);
  const groupsRequested = groups.length;
  const groupsSucceeded = successful.length;
  const groupsFailed = groupsRequested - groupsSucceeded;
  const cappedByMaxGroups = allGroups.length > maxGroups;
  const groupsSkipped = Math.max(0, allGroups.length - groupsRequested);

  return {
    games,
    quota: conservativeQuota(groups.map((group) => group.quota)),
    requests: {
      providerGroups: allGroups.length,
      maxGroups,
      concurrency,
      groupsRequested,
      groupsSucceeded,
      groupsFailed,
      groupsSkipped,
      cappedByMaxGroups,
      stoppedByQuota,
      complete: groupsFailed === 0 && groupsRequested === allGroups.length && !cappedByMaxGroups && !stoppedByQuota
    },
    normalization: {
      targetGames: targetGames.length,
      rowsReceived: successful.reduce((sum, group) => sum + group.rows.length, 0),
      rowsRejected: normalizedRows.filter((row) => row === null || row.quotes.length === 0).length,
      bookmakerQuotesAccepted,
      bookmakerQuotesRejected: Math.max(0, bookmakerCandidates - bookmakerQuotesAccepted),
      gamesAccepted: games.length
    },
    groups: groups.map(groupDiagnostic)
  };
}
