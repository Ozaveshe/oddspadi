import { firstConfiguredEnv } from "@/lib/env";
import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type EnvMap = Record<string, string | undefined>;
type AttachmentStatus = "stored" | "dry-run" | "not-configured" | "provider-error" | "no-matches" | "failed";

type OddsApiOutcome = { name?: string; price?: number };
type OddsApiMarket = { key?: string; last_update?: string; outcomes?: OddsApiOutcome[] };
type OddsApiBookmaker = { key?: string; title?: string; last_update?: string; markets?: OddsApiMarket[] };
type OddsApiEvent = {
  id?: string;
  sport_key?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsApiBookmaker[];
};
type OddsApiHistoricalResponse = { timestamp?: string; data?: OddsApiEvent[]; message?: string };
type StoredFixtureRow = {
  external_id: string;
  provider: string;
  kickoff_at: string;
  home_team_external_id: string;
  away_team_external_id: string;
};
type StoredTeamRow = { external_id: string; name: string };

export type FootballOddsAttachmentRequest = {
  date: string;
  dryRun?: boolean;
  limit?: number;
  regions?: string;
  bookmakers?: string;
  isClosing?: boolean;
  closingWindowMinutes?: number;
  sportKey?: string;
  fixtureProvider?: string;
};

export type FootballStoredFixtureCandidate = {
  fixtureExternalId: string;
  provider: string;
  kickoffAt: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  homeTeamName: string;
  awayTeamName: string;
};

export type FootballOddsQuote = {
  bookmaker: string;
  bookmakerKey: string | null;
  selection: "home" | "draw" | "away";
  decimalOdds: number;
  observedAt: string;
  metadata: Record<string, unknown>;
};

export type FootballOddsEvent = {
  providerEventId: string;
  sportKey: string;
  kickoffAt: string;
  homeTeamName: string;
  awayTeamName: string;
  quotes: FootballOddsQuote[];
};

export type FootballOddsFixtureMatch = {
  event: FootballOddsEvent;
  fixture: FootballStoredFixtureCandidate;
  confidence: number;
  matchedBy: "teams-and-time";
};

export type FootballClosingEligibilityRejection = {
  providerEventId: string;
  fixtureExternalId: string;
  kickoffAt: string;
  snapshotAt: string;
  minutesToKickoff: number;
  reason: "snapshot-after-kickoff" | "outside-closing-window" | "invalid-timestamp";
};

export type FootballOddsAttachmentResult = {
  status: AttachmentStatus;
  configured: boolean;
  dryRun: boolean;
  provider: "the-odds-api";
  endpoint: string | null;
  snapshotAt: string | null;
  fetched: number;
  normalizedEvents: number;
  matchedFixtures: number;
  candidateMatchedFixtures: number;
  closingRequested: boolean;
  closingWindowMinutes: number;
  closingEligibleFixtures: number;
  closingRejectedFixtures: number;
  oddsRows: number;
  rowsWritten: number;
  ingestionRunId?: string;
  reason?: string;
  unmatchedEvents: Array<{
    providerEventId: string;
    homeTeamName: string;
    awayTeamName: string;
    kickoffAt: string;
    reason: string;
  }>;
  closingRejectedEvents: FootballClosingEligibilityRejection[];
  sampleMatches: Array<{
    providerEventId: string;
    fixtureExternalId: string;
    homeTeamName: string;
    awayTeamName: string;
    kickoffAt: string;
    oddsRows: number;
    bookmakers: number;
    confidence: number;
  }>;
};

export const DEFAULT_FOOTBALL_CLOSING_WINDOW_MINUTES = 90;
export const MAX_FOOTBALL_CLOSING_WINDOW_MINUTES = 360;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function isValidIsoTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function oddsApiTimestamp(value: string): string {
  return new Date(value).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function toIsoTimestamp(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function boundedClosingWindow(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value)
    ? Math.min(MAX_FOOTBALL_CLOSING_WINDOW_MINUTES, Math.max(5, value))
    : DEFAULT_FOOTBALL_CLOSING_WINDOW_MINUTES;
}

function redactedUrl(url: URL, apiKey: string): string {
  const clone = new URL(url.toString());
  if (apiKey && clone.searchParams.get("apiKey") === apiKey) clone.searchParams.set("apiKey", "REDACTED");
  return clone.toString();
}

export function normalizeFootballTeamName(value: string): string {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|fc|afc|cf|football club)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const aliases: Record<string, string> = {
    "man utd": "manchester united",
    "man united": "manchester united",
    "man city": "manchester city",
    newcastle: "newcastle united",
    leeds: "leeds united",
    tottenham: "tottenham hotspur",
    wolves: "wolverhampton wanderers",
    spurs: "tottenham hotspur",
    "tottenham hotspurs": "tottenham hotspur",
    "west ham united": "west ham",
    "brighton and hove albion": "brighton"
  };
  return aliases[normalized] ?? normalized;
}

function teamNamesMatch(left: string, right: string): boolean {
  const a = normalizeFootballTeamName(left);
  const b = normalizeFootballTeamName(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(` ${b}`) || b.endsWith(` ${a}`);
}

function hoursBetween(left: string, right: string): number {
  return Math.abs(Date.parse(left) - Date.parse(right)) / (60 * 60 * 1000);
}

function outcomeSelection(name: string | undefined, event: OddsApiEvent): "home" | "draw" | "away" | null {
  const outcome = cleanText(name);
  if (outcome.toLowerCase() === "draw") return "draw";
  if (teamNamesMatch(outcome, cleanText(event.home_team))) return "home";
  if (teamNamesMatch(outcome, cleanText(event.away_team))) return "away";
  return null;
}

export function normalizeFootballOddsEvents(
  response: OddsApiHistoricalResponse,
  { limit }: { limit?: number } = {}
): FootballOddsEvent[] {
  const events = Array.isArray(response.data) ? response.data : [];
  const timestamp = toIsoTimestamp(response.timestamp) ?? new Date().toISOString();
  return events.slice(0, limit && limit > 0 ? limit : undefined).flatMap((event) => {
    const providerEventId = cleanText(event.id);
    const kickoffAt = toIsoTimestamp(event.commence_time);
    const homeTeamName = cleanText(event.home_team);
    const awayTeamName = cleanText(event.away_team);
    if (!providerEventId || !kickoffAt || !homeTeamName || !awayTeamName) return [];

    const quotes =
      event.bookmakers?.flatMap((bookmaker) =>
        bookmaker.markets
          ?.filter((market) => market.key === "h2h")
          .flatMap((market) => {
            const observedAt = toIsoTimestamp(market.last_update) ?? toIsoTimestamp(bookmaker.last_update) ?? timestamp;
            const marketQuotes =
              market.outcomes?.flatMap((outcome) => {
                const selection = outcomeSelection(outcome.name, event);
                if (!selection || typeof outcome.price !== "number" || outcome.price <= 1) return [];
                return [{
                  bookmaker: cleanText(bookmaker.title) || cleanText(bookmaker.key) || "the-odds-api",
                  bookmakerKey: cleanText(bookmaker.key) || null,
                  selection,
                  decimalOdds: outcome.price,
                  observedAt,
                  metadata: {
                    providerEventId,
                    sportKey: cleanText(event.sport_key) || "soccer_epl",
                    marketKey: market.key ?? null,
                    bookmakerKey: bookmaker.key ?? null,
                    snapshotTimestamp: timestamp
                  }
                } satisfies FootballOddsQuote];
              }) ?? [];
            const selections = new Set(marketQuotes.map((quote) => quote.selection));
            return selections.has("home") && selections.has("draw") && selections.has("away") ? marketQuotes : [];
          }) ?? []
      ) ?? [];
    if (!quotes.length) return [];
    return [{
      providerEventId,
      sportKey: cleanText(event.sport_key) || "soccer_epl",
      kickoffAt,
      homeTeamName,
      awayTeamName,
      quotes
    }];
  });
}

export function matchFootballOddsEventsToFixtures(
  events: FootballOddsEvent[],
  fixtures: FootballStoredFixtureCandidate[],
  { maxHours = 12 }: { maxHours?: number } = {}
): { matches: FootballOddsFixtureMatch[]; unmatchedEvents: FootballOddsAttachmentResult["unmatchedEvents"] } {
  const matches: FootballOddsFixtureMatch[] = [];
  const unmatchedEvents: FootballOddsAttachmentResult["unmatchedEvents"] = [];
  const usedFixtures = new Set<string>();
  for (const event of events) {
    const candidates = fixtures
      .filter((fixture) => !usedFixtures.has(fixture.fixtureExternalId))
      .filter((fixture) => teamNamesMatch(event.homeTeamName, fixture.homeTeamName) && teamNamesMatch(event.awayTeamName, fixture.awayTeamName))
      .map((fixture) => ({ fixture, deltaHours: hoursBetween(event.kickoffAt, fixture.kickoffAt) }))
      .filter((candidate) => candidate.deltaHours <= maxHours)
      .sort((left, right) => left.deltaHours - right.deltaHours);
    const best = candidates[0];
    if (!best) {
      unmatchedEvents.push({
        providerEventId: event.providerEventId,
        homeTeamName: event.homeTeamName,
        awayTeamName: event.awayTeamName,
        kickoffAt: event.kickoffAt,
        reason: "No stored API-Football fixture matched the same home/away teams within the allowed kickoff window."
      });
      continue;
    }
    usedFixtures.add(best.fixture.fixtureExternalId);
    matches.push({
      event,
      fixture: best.fixture,
      confidence: Number(Math.max(0.8, 0.995 - best.deltaHours / 100).toFixed(3)),
      matchedBy: "teams-and-time"
    });
  }
  return { matches, unmatchedEvents };
}

export function filterClosingEligibleFootballOddsMatches(
  matches: FootballOddsFixtureMatch[],
  {
    snapshotAt,
    closingWindowMinutes = DEFAULT_FOOTBALL_CLOSING_WINDOW_MINUTES
  }: {
    snapshotAt: string;
    closingWindowMinutes?: number;
  }
): {
  eligibleMatches: FootballOddsFixtureMatch[];
  rejectedEvents: FootballClosingEligibilityRejection[];
  closingWindowMinutes: number;
} {
  const windowMinutes = boundedClosingWindow(closingWindowMinutes);
  const snapshotTimestamp = Date.parse(snapshotAt);
  const eligibleMatches: FootballOddsFixtureMatch[] = [];
  const rejectedEvents: FootballClosingEligibilityRejection[] = [];

  for (const match of matches) {
    const kickoffTimestamp = Date.parse(match.fixture.kickoffAt);
    const validTimestamps = Number.isFinite(snapshotTimestamp) && Number.isFinite(kickoffTimestamp);
    const minutesToKickoff = validTimestamps
      ? Number(((kickoffTimestamp - snapshotTimestamp) / (60 * 1000)).toFixed(3))
      : Number.NaN;
    const reason = !validTimestamps
      ? "invalid-timestamp"
      : minutesToKickoff < 0
        ? "snapshot-after-kickoff"
        : minutesToKickoff > windowMinutes
          ? "outside-closing-window"
          : null;
    if (!reason) {
      eligibleMatches.push(match);
      continue;
    }
    rejectedEvents.push({
      providerEventId: match.event.providerEventId,
      fixtureExternalId: match.fixture.fixtureExternalId,
      kickoffAt: match.fixture.kickoffAt,
      snapshotAt,
      minutesToKickoff,
      reason
    });
  }

  return { eligibleMatches, rejectedEvents, closingWindowMinutes: windowMinutes };
}

function marginAdjustedRows(rows: Array<Record<string, unknown> & { implied_probability: number; margin_adjusted_probability: number | null }>) {
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.fixture_external_id}:${row.market}:${row.bookmaker}:${row.is_closing}:${row.observed_at}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  for (const groupRows of grouped.values()) {
    const selections = new Set(groupRows.map((row) => row.selection));
    if (!selections.has("home") || !selections.has("draw") || !selections.has("away")) continue;
    const margin = groupRows.reduce((sum, row) => sum + row.implied_probability, 0);
    if (margin <= 0) continue;
    for (const row of groupRows) row.margin_adjusted_probability = Number((row.implied_probability / margin).toFixed(6));
  }
  return rows;
}

export function footballOddsRowsForMatches(matches: FootballOddsFixtureMatch[], { isClosing = false }: { isClosing?: boolean } = {}) {
  return marginAdjustedRows(matches.flatMap((match) =>
    match.event.quotes.map((quote) => ({
      fixture_external_id: match.fixture.fixtureExternalId,
      sport: "football",
      provider: "the_odds_api",
      bookmaker: quote.bookmaker,
      market: "match_winner",
      selection: quote.selection,
      decimal_odds: quote.decimalOdds,
      implied_probability: Number((1 / quote.decimalOdds).toFixed(6)),
      margin_adjusted_probability: null as number | null,
      is_closing: isClosing,
      observed_at: quote.observedAt,
      metadata: {
        ...quote.metadata,
        attachedToProvider: match.fixture.provider,
        providerEventId: match.event.providerEventId,
        matchedBy: match.matchedBy,
        matchConfidence: match.confidence,
        eventKickoffAt: match.event.kickoffAt,
        storedFixtureKickoffAt: match.fixture.kickoffAt
      }
    }))
  ));
}

async function fetchJson(fetchImpl: FetchLike, url: URL): Promise<{ data?: unknown; error?: string }> {
  const response = await fetchImpl(url);
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text().catch(() => "");
  if (!response.ok) {
    if (data && typeof data === "object" && "message" in data) return { data, error: String((data as { message?: unknown }).message) };
    return { data, error: `Provider returned HTTP ${response.status}.` };
  }
  return { data };
}

async function readStoredFootballFixturesForEvents(
  events: FootballOddsEvent[],
  fixtureProvider: string
): Promise<FootballStoredFixtureCandidate[] | { error: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };
  if (!events.length) return [];
  const timestamps = events.map((event) => Date.parse(event.kickoffAt)).filter(Number.isFinite);
  if (!timestamps.length) return [];
  const from = new Date(Math.min(...timestamps) - 12 * 60 * 60 * 1000).toISOString();
  const to = new Date(Math.max(...timestamps) + 12 * 60 * 60 * 1000).toISOString();
  const { data: fixtureRows, error: fixtureError } = await client
    .from("op_fixtures")
    .select("external_id, provider, kickoff_at, home_team_external_id, away_team_external_id")
    .eq("sport", "football")
    .eq("provider", fixtureProvider)
    .eq("status", "finished")
    .gte("kickoff_at", from)
    .lte("kickoff_at", to)
    .limit(500);
  if (fixtureError) return { error: fixtureError.message };
  const fixtures = (fixtureRows ?? []) as StoredFixtureRow[];
  const teamIds = [...new Set(fixtures.flatMap((fixture) => [fixture.home_team_external_id, fixture.away_team_external_id]))];
  if (!teamIds.length) return [];
  const teams: StoredTeamRow[] = [];
  for (let index = 0; index < teamIds.length; index += 100) {
    const chunk = teamIds.slice(index, index + 100);
    const { data, error } = await client
      .from("op_teams")
      .select("external_id, name")
      .eq("sport", "football")
      .eq("provider", fixtureProvider)
      .in("external_id", chunk);
    if (error) return { error: error.message };
    teams.push(...((data ?? []) as StoredTeamRow[]));
  }
  const teamNameById = new Map(teams.map((team) => [team.external_id, team.name]));
  return fixtures.flatMap((fixture) => {
    const homeTeamName = teamNameById.get(fixture.home_team_external_id);
    const awayTeamName = teamNameById.get(fixture.away_team_external_id);
    if (!homeTeamName || !awayTeamName) return [];
    return [{
      fixtureExternalId: fixture.external_id,
      provider: fixture.provider,
      kickoffAt: new Date(fixture.kickoff_at).toISOString(),
      homeTeamExternalId: fixture.home_team_external_id,
      awayTeamExternalId: fixture.away_team_external_id,
      homeTeamName,
      awayTeamName
    }];
  });
}

async function createIngestionRun(rowsReceived: number, request: FootballOddsAttachmentRequest) {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };
  const { data, error } = await client.from("op_provider_ingestion_runs").insert({
    provider: "the_odds_api",
    sport: "football",
    ingestion_type: "historical_football_odds_attachment",
    status: "running",
    started_at: new Date().toISOString(),
    rows_received: rowsReceived,
    metadata: {
      date: request.date,
      sportKey: request.sportKey ?? "soccer_epl",
      regions: request.regions ?? "uk",
      bookmakers: request.bookmakers ?? null,
      fixtureProvider: request.fixtureProvider ?? "api_football",
      isClosing: Boolean(request.isClosing),
      closingWindowMinutes: boundedClosingWindow(request.closingWindowMinutes)
    }
  }).select("id").single();
  if (error) return { error: error.message };
  return { id: String(data.id) };
}

async function finishIngestionRun(id: string, status: "completed" | "failed", rowsWritten: number, errorMessage?: string) {
  const client = getSupabaseServerClient();
  if (!client) return;
  await client.from("op_provider_ingestion_runs").update({
    status,
    completed_at: new Date().toISOString(),
    rows_written: rowsWritten,
    error_message: errorMessage ?? null
  }).eq("id", id);
}

export async function attachFootballHistoricalOdds({
  request,
  env = process.env,
  fetchImpl = fetch
}: {
  request: FootballOddsAttachmentRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
}): Promise<FootballOddsAttachmentResult> {
  const apiKey = firstConfiguredEnv(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const sportKey = cleanText(request.sportKey) || "soccer_epl";
  const fixtureProvider = cleanText(request.fixtureProvider) || "api_football";
  const closingRequested = Boolean(request.isClosing);
  const closingWindowMinutes = boundedClosingWindow(request.closingWindowMinutes);
  const endpoint = new URL(`https://api.the-odds-api.com/v4/historical/sports/${encodeURIComponent(sportKey)}/odds/`);
  endpoint.searchParams.set("markets", "h2h");
  endpoint.searchParams.set("oddsFormat", "decimal");
  endpoint.searchParams.set("dateFormat", "iso");
  endpoint.searchParams.set("regions", request.regions?.trim() || "uk");
  if (request.bookmakers?.trim()) endpoint.searchParams.set("bookmakers", request.bookmakers.trim());
  if (request.date && isValidIsoTimestamp(request.date)) endpoint.searchParams.set("date", oddsApiTimestamp(request.date));
  if (apiKey) endpoint.searchParams.set("apiKey", apiKey);
  const baseResult = {
    configured: Boolean(apiKey),
    dryRun: request.dryRun ?? true,
    provider: "the-odds-api" as const,
    endpoint: redactedUrl(endpoint, apiKey),
    snapshotAt: null,
    fetched: 0,
    normalizedEvents: 0,
    matchedFixtures: 0,
    candidateMatchedFixtures: 0,
    closingRequested,
    closingWindowMinutes,
    closingEligibleFixtures: 0,
    closingRejectedFixtures: 0,
    oddsRows: 0,
    rowsWritten: 0,
    unmatchedEvents: [],
    closingRejectedEvents: [],
    sampleMatches: []
  };
  if (!apiKey) return { ...baseResult, status: "not-configured", configured: false, reason: "Missing THE_ODDS_API_KEY or ODDS_API_KEY." };
  if (!request.date || !isValidIsoTimestamp(request.date)) {
    return { ...baseResult, status: "failed", reason: "Football historical odds attachment requires date=ISO_TIMESTAMP." };
  }
  const { data, error } = await fetchJson(fetchImpl, endpoint);
  if (error) return { ...baseResult, status: "provider-error", reason: error };
  const response = data as OddsApiHistoricalResponse;
  const snapshotAt = toIsoTimestamp(response.timestamp) ?? oddsApiTimestamp(request.date);
  const events = normalizeFootballOddsEvents(response, { limit: request.limit });
  const fixtureCandidates = await readStoredFootballFixturesForEvents(events, fixtureProvider);
  if ("error" in fixtureCandidates) {
    return {
      ...baseResult,
      status: "failed",
      snapshotAt,
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      reason: fixtureCandidates.error
    };
  }
  const { matches, unmatchedEvents } = matchFootballOddsEventsToFixtures(events, fixtureCandidates);
  const closingEligibility = closingRequested
    ? filterClosingEligibleFootballOddsMatches(matches, { snapshotAt, closingWindowMinutes })
    : { eligibleMatches: matches, rejectedEvents: [], closingWindowMinutes };
  const selectedMatches = closingEligibility.eligibleMatches;
  const rows = footballOddsRowsForMatches(selectedMatches, { isClosing: closingRequested });
  const sampleMatches = selectedMatches.slice(0, 8).map((match) => ({
    providerEventId: match.event.providerEventId,
    fixtureExternalId: match.fixture.fixtureExternalId,
    homeTeamName: match.fixture.homeTeamName,
    awayTeamName: match.fixture.awayTeamName,
    kickoffAt: match.fixture.kickoffAt,
    oddsRows: match.event.quotes.length,
    bookmakers: new Set(match.event.quotes.map((quote) => quote.bookmaker)).size,
    confidence: match.confidence
  }));
  if (request.dryRun ?? true) {
    return {
      ...baseResult,
      status: selectedMatches.length ? "dry-run" : "no-matches",
      snapshotAt,
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: selectedMatches.length,
      candidateMatchedFixtures: matches.length,
      closingEligibleFixtures: selectedMatches.length,
      closingRejectedFixtures: closingEligibility.rejectedEvents.length,
      oddsRows: rows.length,
      unmatchedEvents,
      closingRejectedEvents: closingEligibility.rejectedEvents,
      sampleMatches,
      reason: selectedMatches.length
        ? undefined
        : closingRequested && matches.length
          ? `Matched fixtures were rejected because the returned snapshot was outside the ${closingWindowMinutes}-minute closing window.`
          : "The provider returned odds, but no events matched stored finished API-Football fixtures."
    };
  }
  const runtime = getSupabaseRuntimeStatus(env);
  if (!runtime.serverWriteReady) {
    return {
      ...baseResult,
      status: "not-configured",
      configured: false,
      snapshotAt,
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: selectedMatches.length,
      candidateMatchedFixtures: matches.length,
      closingEligibleFixtures: selectedMatches.length,
      closingRejectedFixtures: closingEligibility.rejectedEvents.length,
      oddsRows: rows.length,
      unmatchedEvents,
      closingRejectedEvents: closingEligibility.rejectedEvents,
      sampleMatches,
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }
  const client = getSupabaseServerClient(env);
  if (!client) return {
    ...baseResult,
    status: "failed",
    snapshotAt,
    reason: "Supabase client could not be created.",
    unmatchedEvents,
    closingRejectedEvents: closingEligibility.rejectedEvents,
    sampleMatches
  };
  const ingestionRun = await createIngestionRun(rows.length, request);
  if ("error" in ingestionRun) return {
    ...baseResult,
    status: "failed",
    snapshotAt,
    reason: ingestionRun.error,
    unmatchedEvents,
    closingRejectedEvents: closingEligibility.rejectedEvents,
    sampleMatches
  };

  const archivePayload = async (attachmentStatus: "stored" | "no-matches") => {
    const payloadHash = stableHash({ response, matches: sampleMatches, rows: rows.length, attachmentStatus });
    const { error: rawError } = await client.from("op_raw_provider_payloads").insert({
      ingestion_run_id: ingestionRun.id,
      provider: "the_odds_api",
      sport: "football",
      payload_type: "historical_football_odds_attachment",
      external_id: `${sportKey}:${request.date}`,
      source_url: redactedUrl(endpoint, apiKey),
      payload: {
        request: {
          date: request.date,
          sportKey,
          regions: request.regions ?? "uk",
          bookmakers: request.bookmakers ?? null,
          fixtureProvider,
          isClosing: closingRequested,
          closingWindowMinutes
        },
        attachmentStatus,
        snapshotAt,
        providerResponse: response,
        matchedFixtures: sampleMatches,
        unmatchedEvents,
        closingRejectedEvents: closingEligibility.rejectedEvents
      },
      payload_hash: payloadHash,
      observed_at: request.date
    });
    if (rawError) throw new Error(rawError.message);
  };

  if (!selectedMatches.length || !rows.length) {
    const reason = closingRequested && matches.length
      ? `No matched fixture was inside the ${closingWindowMinutes}-minute closing window.`
      : "No confident football fixture matches were available for odds attachment.";
    try {
      await archivePayload("no-matches");
      await finishIngestionRun(ingestionRun.id, "completed", 0);
      return {
        ...baseResult,
        status: "no-matches",
        snapshotAt,
        fetched: Array.isArray(response.data) ? response.data.length : 0,
        normalizedEvents: events.length,
        candidateMatchedFixtures: matches.length,
        closingEligibleFixtures: selectedMatches.length,
        closingRejectedFixtures: closingEligibility.rejectedEvents.length,
        ingestionRunId: ingestionRun.id,
        unmatchedEvents,
        closingRejectedEvents: closingEligibility.rejectedEvents,
        reason
      };
    } catch (writeError) {
      const message = writeError instanceof Error ? writeError.message : "Football no-match audit failed.";
      await finishIngestionRun(ingestionRun.id, "failed", 0, message);
      return {
        ...baseResult,
        status: "failed",
        snapshotAt,
        fetched: Array.isArray(response.data) ? response.data.length : 0,
        normalizedEvents: events.length,
        candidateMatchedFixtures: matches.length,
        closingRejectedFixtures: closingEligibility.rejectedEvents.length,
        ingestionRunId: ingestionRun.id,
        unmatchedEvents,
        closingRejectedEvents: closingEligibility.rejectedEvents,
        reason: message
      };
    }
  }

  try {
    const fixtureExternalIds = [...new Set(rows.map((row) => String(row.fixture_external_id)))];
    const observedTimes = [...new Set(rows.map((row) => String(row.observed_at)))];
    for (let index = 0; index < fixtureExternalIds.length; index += 100) {
      const fixtureChunk = fixtureExternalIds.slice(index, index + 100);
      for (let timeIndex = 0; timeIndex < observedTimes.length; timeIndex += 100) {
        const timeChunk = observedTimes.slice(timeIndex, timeIndex + 100);
        const { error: deleteError } = await client.from("op_odds_snapshots").delete()
          .eq("sport", "football").eq("provider", "the_odds_api")
          .in("fixture_external_id", fixtureChunk).in("observed_at", timeChunk);
        if (deleteError) throw new Error(deleteError.message);
      }
    }
    for (let index = 0; index < rows.length; index += 100) {
      const { error: insertError } = await client.from("op_odds_snapshots").insert(rows.slice(index, index + 100));
      if (insertError) throw new Error(insertError.message);
    }
    await archivePayload("stored");
    await finishIngestionRun(ingestionRun.id, "completed", rows.length);
    return {
      ...baseResult,
      status: "stored",
      snapshotAt,
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: selectedMatches.length,
      candidateMatchedFixtures: matches.length,
      closingEligibleFixtures: selectedMatches.length,
      closingRejectedFixtures: closingEligibility.rejectedEvents.length,
      oddsRows: rows.length,
      rowsWritten: rows.length,
      ingestionRunId: ingestionRun.id,
      unmatchedEvents,
      closingRejectedEvents: closingEligibility.rejectedEvents,
      sampleMatches
    };
  } catch (writeError) {
    const message = writeError instanceof Error ? writeError.message : "Football odds attachment failed.";
    await finishIngestionRun(ingestionRun.id, "failed", 0, message);
    return {
      ...baseResult,
      status: "failed",
      snapshotAt,
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: selectedMatches.length,
      candidateMatchedFixtures: matches.length,
      closingEligibleFixtures: selectedMatches.length,
      closingRejectedFixtures: closingEligibility.rejectedEvents.length,
      oddsRows: rows.length,
      ingestionRunId: ingestionRun.id,
      unmatchedEvents,
      closingRejectedEvents: closingEligibility.rejectedEvents,
      sampleMatches,
      reason: message
    };
  }
}
