import { buildBestExecutableQuote, type ExecutableOddsQuote } from "@/lib/sports/executableOdds";
import { buildNoVigBookmakerConsensus } from "@/lib/sports/oddsConsensus";
import type { OddsMarket } from "@/lib/sports/types";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type JsonRecord = Record<string, unknown>;

export const API_TENNIS_ODDS_BASE_URL = "https://api.api-tennis.com/tennis/";

export type ApiTennisOddsBlockerCode =
  | "complete-match-winner-market-missing"
  | "provider-bookmaker-id-missing"
  | "provider-quote-timestamp-missing";

export type ApiTennisMatchWinnerQuoteEvidence = {
  /** Exact provider object key from the Home/Away bookmaker maps. */
  bookmakerName: string;
  /** Exact provider ID, only when explicitly present on both outcome quotes. */
  providerBookmakerId: string | null;
  /** Collision-safe shared ID. Never derived from a display name. */
  bookmakerId: string | null;
  homeDecimalOdds: number;
  awayDecimalOdds: number;
  /** Exact per-quote provider timestamp, only when both outcomes report the same value. */
  observedAt: string | null;
  publicationEligible: boolean;
  blockers: ApiTennisOddsBlockerCode[];
};

export type ApiTennisMatchWinnerOdds = {
  /** Exact `match_key` represented by the provider response object key. */
  providerMatchKey: string;
  /** Optional match-level timestamp retained for diagnostics, never promoted to quote freshness. */
  providerUpdatedAt: string | null;
  quoteEvidence: ApiTennisMatchWinnerQuoteEvidence[];
  /** Empty unless at least one complete quote has exact identity and freshness evidence. */
  oddsMarkets: OddsMarket[];
  publicationEligible: boolean;
  blockers: ApiTennisOddsBlockerCode[];
};

export type ApiTennisOddsNormalization = {
  matchesReceived: number;
  matchesRejected: number;
  matchesWithCompletePrices: number;
  matchesPublicationEligible: number;
  bookmakerCandidates: number;
  bookmakerQuotesAccepted: number;
  bookmakerQuotesRejected: number;
  bookmakerQuotesPublicationEligible: number;
};

export type ApiTennisOddsFetchResult = {
  fixtures: ApiTennisMatchWinnerOdds[];
  request: {
    method: "get_odds";
    dateStart: string | null;
    dateStop: string | null;
    matchKey: string | null;
    eventTypeKey: string | null;
    tournamentKey: string | null;
  };
  httpStatus: number | null;
  ok: boolean;
  error: string | null;
  normalization: ApiTennisOddsNormalization;
  blockers: Array<{
    code: ApiTennisOddsBlockerCode;
    affectedFixtures: number;
    detail: string;
  }>;
};

export type ApiTennisOddsQuery = {
  apiKey: string;
  dateStart?: string;
  dateStop?: string;
  matchKey?: string | number;
  eventTypeKey?: string | number;
  tournamentKey?: string | number;
  baseUrl?: string;
};

export type FetchApiTennisOddsOptions = ApiTennisOddsQuery & {
  fetchImpl?: FetchLike;
  signal?: AbortSignal;
};

type ParsedPrice = {
  decimalOdds: number;
  providerBookmakerId: string | null;
  bookmakerName: string | null;
  observedAt: string | null;
};

type EligibleQuote = ExecutableOddsQuote & {
  providerBookmakerId: string;
  bookmaker: NonNullable<OddsMarket["bookmaker"]>;
  observedAt: string;
};

const EMPTY_NORMALIZATION: ApiTennisOddsNormalization = {
  matchesReceived: 0,
  matchesRejected: 0,
  matchesWithCompletePrices: 0,
  matchesPublicationEligible: 0,
  bookmakerCandidates: 0,
  bookmakerQuotesAccepted: 0,
  bookmakerQuotesRejected: 0,
  bookmakerQuotesPublicationEligible: 0
};

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = value.trim();
  return cleaned || null;
}

function providerId(value: unknown): string | null {
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  const cleaned = cleanText(value);
  return cleaned && /^\d+$/.test(cleaned) && /[1-9]/.test(cleaned) ? cleaned : null;
}

function selector(value: string | number | undefined, label: string): string | null {
  if (value === undefined) return null;
  const parsed = providerId(value);
  if (!parsed) throw new TypeError(`API-Tennis odds ${label} must be a positive provider identifier.`);
  return parsed;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function quoteTimestamp(value: unknown): string | null {
  const cleaned = cleanText(value);
  return cleaned && Number.isFinite(Date.parse(cleaned)) ? cleaned : null;
}

function explicitTimestamp(item: JsonRecord): string | null {
  for (const key of ["observed_at", "updated_at", "last_update", "timestamp"]) {
    const value = quoteTimestamp(item[key]);
    if (value) return value;
  }
  return null;
}

function explicitBookmakerId(item: JsonRecord): string | null {
  const nested = record(item.bookmaker);
  return providerId(item.bookmaker_id)
    ?? providerId(item.bookmaker_key)
    ?? providerId(nested?.id)
    ?? providerId(nested?.key);
}

function explicitBookmakerName(item: JsonRecord): string | null {
  const nested = record(item.bookmaker);
  return cleanText(item.bookmaker_name) ?? cleanText(nested?.name);
}

function decimalOdds(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 1 ? value : null;
  const cleaned = cleanText(value);
  if (!cleaned || !/^\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed > 1 ? parsed : null;
}

function priceCell(value: unknown): ParsedPrice | null {
  const directPrice = decimalOdds(value);
  if (directPrice !== null) {
    return { decimalOdds: directPrice, providerBookmakerId: null, bookmakerName: null, observedAt: null };
  }
  const item = record(value);
  if (!item) return null;
  const price = decimalOdds(item.odd ?? item.odds ?? item.price ?? item.value);
  if (price === null) return null;
  return {
    decimalOdds: price,
    providerBookmakerId: explicitBookmakerId(item),
    bookmakerName: explicitBookmakerName(item),
    observedAt: explicitTimestamp(item)
  };
}

function matchUpdatedAt(item: JsonRecord): string | null {
  // Retain explicit match-level metadata for diagnostics. It is deliberately
  // not copied onto bookmaker quotes because that would manufacture freshness.
  return explicitTimestamp(item);
}

function quoteEvidence(bookmakerName: string, homeValue: unknown, awayValue: unknown): ApiTennisMatchWinnerQuoteEvidence | null {
  const home = priceCell(homeValue);
  const away = priceCell(awayValue);
  if (!home || !away) return null;

  const homeName = home.bookmakerName;
  const awayName = away.bookmakerName;
  if ((homeName && homeName !== bookmakerName) || (awayName && awayName !== bookmakerName) || (homeName && awayName && homeName !== awayName)) {
    return null;
  }
  if (home.providerBookmakerId && away.providerBookmakerId && home.providerBookmakerId !== away.providerBookmakerId) {
    return null;
  }

  const providerBookmakerId = home.providerBookmakerId && away.providerBookmakerId
    ? home.providerBookmakerId
    : null;
  const observedAt = home.observedAt && away.observedAt && home.observedAt === away.observedAt
    ? home.observedAt
    : null;
  const blockers: ApiTennisOddsBlockerCode[] = [
    ...(providerBookmakerId ? [] : ["provider-bookmaker-id-missing" as const]),
    ...(observedAt ? [] : ["provider-quote-timestamp-missing" as const])
  ];

  return {
    bookmakerName,
    providerBookmakerId,
    bookmakerId: providerBookmakerId ? `api-tennis-bookmaker:${providerBookmakerId}` : null,
    homeDecimalOdds: home.decimalOdds,
    awayDecimalOdds: away.decimalOdds,
    observedAt,
    publicationEligible: blockers.length === 0,
    blockers
  };
}

function eligibleQuote(evidence: ApiTennisMatchWinnerQuoteEvidence): EligibleQuote | null {
  if (!evidence.publicationEligible || !evidence.providerBookmakerId || !evidence.bookmakerId || !evidence.observedAt) return null;
  const bookmaker = { id: evidence.bookmakerId, name: evidence.bookmakerName };
  return {
    providerBookmakerId: evidence.providerBookmakerId,
    bookmaker,
    observedAt: evidence.observedAt,
    selections: [
      { id: "home", label: "Home", decimalOdds: evidence.homeDecimalOdds },
      { id: "away", label: "Away", decimalOdds: evidence.awayDecimalOdds }
    ]
  };
}

function buildMarket(quotes: EligibleQuote[]): OddsMarket[] {
  const executable = buildBestExecutableQuote(quotes);
  if (!executable || executable.selections.length !== 2) return [];
  return [{
    id: "match_winner",
    name: "Match winner",
    selections: executable.selections,
    ...(executable.bookmaker ? { bookmaker: executable.bookmaker } : {}),
    priceMethod: "best-price-per-selection-v1",
    consensus: buildNoVigBookmakerConsensus(quotes)
  }];
}

function normalizeMatch(matchKey: string, value: unknown): {
  fixture: ApiTennisMatchWinnerOdds | null;
  candidates: number;
  accepted: number;
  rejected: number;
  eligible: number;
} {
  const item = record(value);
  const market = record(item?.["Home/Away"]);
  const home = record(market?.Home);
  const away = record(market?.Away);
  if (!item || !market || !home || !away) {
    return { fixture: null, candidates: 0, accepted: 0, rejected: 0, eligible: 0 };
  }

  const bookmakerKeys = [...new Set([...Object.keys(home), ...Object.keys(away)])]
    .filter((name) => cleanText(name) !== null)
    .sort((left, right) => left.localeCompare(right));
  const evidence = bookmakerKeys.flatMap((bookmakerKey) => {
    if (!(bookmakerKey in home) || !(bookmakerKey in away)) return [];
    const quote = quoteEvidence(cleanText(bookmakerKey)!, home[bookmakerKey], away[bookmakerKey]);
    return quote ? [quote] : [];
  });
  const eligible = evidence.map(eligibleQuote).filter((quote): quote is EligibleQuote => quote !== null);
  const oddsMarkets = buildMarket(eligible);
  const blockers = evidence.length
    ? [...new Set(evidence.flatMap((quote) => quote.blockers))]
    : ["complete-match-winner-market-missing" as const];

  return {
    fixture: {
      providerMatchKey: matchKey,
      providerUpdatedAt: matchUpdatedAt(item),
      quoteEvidence: evidence,
      oddsMarkets,
      publicationEligible: oddsMarkets.length > 0,
      blockers
    },
    candidates: bookmakerKeys.length,
    accepted: evidence.length,
    rejected: bookmakerKeys.length - evidence.length,
    eligible: eligible.length
  };
}

function blockerSummary(fixtures: ApiTennisMatchWinnerOdds[]): ApiTennisOddsFetchResult["blockers"] {
  const details: Record<ApiTennisOddsBlockerCode, string> = {
    "complete-match-winner-market-missing": "API-Tennis did not return a complete decimal Home/Away quote for this match.",
    "provider-bookmaker-id-missing": "API-Tennis did not report an exact bookmaker ID for both outcome prices; display names are retained but never promoted into invented IDs.",
    "provider-quote-timestamp-missing": "API-Tennis did not report the exact observation time for both outcome prices, so the current freshness/publication gate must remain closed."
  };
  const codes = Object.keys(details) as ApiTennisOddsBlockerCode[];
  return codes.flatMap((code) => {
    const affectedFixtures = fixtures.filter((fixture) => fixture.blockers.includes(code)).length;
    return affectedFixtures ? [{ code, affectedFixtures, detail: details[code] }] : [];
  });
}

function requestReceipt(query: ApiTennisOddsQuery): ApiTennisOddsFetchResult["request"] {
  return {
    method: "get_odds",
    dateStart: query.dateStart ?? null,
    dateStop: query.dateStop ?? null,
    matchKey: query.matchKey === undefined ? null : String(query.matchKey),
    eventTypeKey: query.eventTypeKey === undefined ? null : String(query.eventTypeKey),
    tournamentKey: query.tournamentKey === undefined ? null : String(query.tournamentKey)
  };
}

/**
 * Builds the official API-Tennis `get_odds` query. The URL contains the secret
 * because that is the provider's contract; callers must keep it server-only and
 * must never serialize or log the returned URL.
 */
export function buildApiTennisOddsUrl(query: ApiTennisOddsQuery): URL {
  const apiKey = query.apiKey.trim();
  if (!apiKey) throw new TypeError("API-Tennis odds requires a non-empty server-only API key.");

  const hasDateStart = query.dateStart !== undefined;
  const hasDateStop = query.dateStop !== undefined;
  if (hasDateStart !== hasDateStop) throw new TypeError("API-Tennis odds requires dateStart and dateStop together.");
  if (query.dateStart && !validDate(query.dateStart)) throw new TypeError("API-Tennis odds dateStart must be a real YYYY-MM-DD calendar date.");
  if (query.dateStop && !validDate(query.dateStop)) throw new TypeError("API-Tennis odds dateStop must be a real YYYY-MM-DD calendar date.");
  if (query.dateStart && query.dateStop && query.dateStart > query.dateStop) throw new TypeError("API-Tennis odds dateStart must not be after dateStop.");

  const matchKey = selector(query.matchKey, "matchKey");
  const eventTypeKey = selector(query.eventTypeKey, "eventTypeKey");
  const tournamentKey = selector(query.tournamentKey, "tournamentKey");
  if (!matchKey && !hasDateStart) throw new TypeError("API-Tennis odds requires an exact matchKey or a bounded date range.");

  const endpoint = new URL(query.baseUrl ?? API_TENNIS_ODDS_BASE_URL);
  if (endpoint.protocol !== "https:") throw new TypeError("API-Tennis odds baseUrl must use HTTPS.");
  endpoint.search = "";
  endpoint.searchParams.set("method", "get_odds");
  if (query.dateStart) endpoint.searchParams.set("date_start", query.dateStart);
  if (query.dateStop) endpoint.searchParams.set("date_stop", query.dateStop);
  if (eventTypeKey) endpoint.searchParams.set("event_type_key", eventTypeKey);
  if (tournamentKey) endpoint.searchParams.set("tournament_key", tournamentKey);
  if (matchKey) endpoint.searchParams.set("match_key", matchKey);
  endpoint.searchParams.set("APIkey", apiKey);
  return endpoint;
}

/** Pure normalization of an API-Tennis `get_odds` response. */
export function normalizeApiTennisMatchWinnerOdds(payload: unknown): Pick<ApiTennisOddsFetchResult, "fixtures" | "normalization" | "blockers"> {
  const body = record(payload);
  const result = record(body?.result);
  if (!body || (body.success !== 1 && body.success !== "1") || !result) {
    return { fixtures: [], normalization: { ...EMPTY_NORMALIZATION }, blockers: [] };
  }

  const rows = Object.entries(result);
  const normalized = rows.map(([matchKey, value]) => providerId(matchKey) !== null
    ? normalizeMatch(matchKey, value)
    : { fixture: null, candidates: 0, accepted: 0, rejected: 0, eligible: 0 });
  const fixtures = normalized.flatMap((item) => item.fixture ? [item.fixture] : []);
  const normalization: ApiTennisOddsNormalization = {
    matchesReceived: rows.length,
    matchesRejected: rows.length - fixtures.length,
    matchesWithCompletePrices: fixtures.filter((fixture) => fixture.quoteEvidence.length > 0).length,
    matchesPublicationEligible: fixtures.filter((fixture) => fixture.publicationEligible).length,
    bookmakerCandidates: normalized.reduce((sum, item) => sum + item.candidates, 0),
    bookmakerQuotesAccepted: normalized.reduce((sum, item) => sum + item.accepted, 0),
    bookmakerQuotesRejected: normalized.reduce((sum, item) => sum + item.rejected, 0),
    bookmakerQuotesPublicationEligible: normalized.reduce((sum, item) => sum + item.eligible, 0)
  };
  return { fixtures, normalization, blockers: blockerSummary(fixtures) };
}

/**
 * Fetches API-Tennis odds through an injected transport and returns only safe,
 * normalized evidence. Neither the secret query URL nor raw provider payload is
 * included in the result.
 */
export async function fetchApiTennisMatchWinnerOdds(options: FetchApiTennisOddsOptions): Promise<ApiTennisOddsFetchResult> {
  const endpoint = buildApiTennisOddsUrl(options);
  const request = requestReceipt(options);
  const fetchImpl = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(endpoint, { headers: { accept: "application/json" }, signal: options.signal });
  } catch {
    return {
      fixtures: [], request, httpStatus: null, ok: false,
      error: "API-Tennis odds request failed.", normalization: { ...EMPTY_NORMALIZATION }, blockers: []
    };
  }

  if (!response.ok) {
    return {
      fixtures: [], request, httpStatus: response.status, ok: false,
      error: `API-Tennis returned HTTP ${response.status}.`, normalization: { ...EMPTY_NORMALIZATION }, blockers: []
    };
  }
  const payload = await response.json().catch(() => null);
  const body = record(payload);
  if (!body || (body.success !== 1 && body.success !== "1") || !record(body.result)) {
    return {
      fixtures: [], request, httpStatus: response.status, ok: false,
      error: "API-Tennis returned a malformed odds response.", normalization: { ...EMPTY_NORMALIZATION }, blockers: []
    };
  }
  const normalized = normalizeApiTennisMatchWinnerOdds(payload);
  return { ...normalized, request, httpStatus: response.status, ok: true, error: null };
}
