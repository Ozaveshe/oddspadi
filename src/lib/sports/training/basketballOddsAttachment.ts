import { firstConfiguredEnv } from "@/lib/env";
import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type EnvMap = Record<string, string | undefined>;
type AttachmentStatus = "stored" | "dry-run" | "not-configured" | "provider-error" | "no-matches" | "failed";

type OddsApiOutcome = {
  name?: string;
  price?: number;
};

type OddsApiMarket = {
  key?: string;
  last_update?: string;
  outcomes?: OddsApiOutcome[];
};

type OddsApiBookmaker = {
  key?: string;
  title?: string;
  last_update?: string;
  markets?: OddsApiMarket[];
};

type OddsApiEvent = {
  id?: string;
  sport_key?: string;
  sport_title?: string;
  commence_time?: string;
  home_team?: string;
  away_team?: string;
  bookmakers?: OddsApiBookmaker[];
};

type OddsApiHistoricalResponse = {
  timestamp?: string;
  data?: OddsApiEvent[];
  message?: string;
};

type StoredFixtureRow = {
  external_id: string;
  provider: string;
  kickoff_at: string;
  home_team_external_id: string;
  away_team_external_id: string;
};

type StoredTeamRow = {
  external_id: string;
  name: string;
};

export type BasketballOddsAttachmentRequest = {
  date: string;
  dryRun?: boolean;
  limit?: number;
  regions?: string;
  bookmakers?: string;
  isClosing?: boolean;
};

export type BasketballStoredFixtureCandidate = {
  fixtureExternalId: string;
  provider: string;
  kickoffAt: string;
  homeTeamExternalId: string;
  awayTeamExternalId: string;
  homeTeamName: string;
  awayTeamName: string;
};

export type BasketballOddsQuote = {
  bookmaker: string;
  bookmakerKey: string | null;
  selection: "home" | "away";
  decimalOdds: number;
  observedAt: string;
  metadata: Record<string, unknown>;
};

export type BasketballOddsEvent = {
  providerEventId: string;
  sportKey: string;
  kickoffAt: string;
  homeTeamName: string;
  awayTeamName: string;
  quotes: BasketballOddsQuote[];
};

export type BasketballOddsFixtureMatch = {
  event: BasketballOddsEvent;
  fixture: BasketballStoredFixtureCandidate;
  confidence: number;
  matchedBy: "teams-and-time";
};

export type BasketballOddsAttachmentResult = {
  status: AttachmentStatus;
  configured: boolean;
  dryRun: boolean;
  provider: "the-odds-api";
  endpoint: string | null;
  fetched: number;
  normalizedEvents: number;
  matchedFixtures: number;
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
  sampleMatches: Array<{
    providerEventId: string;
    fixtureExternalId: string;
    homeTeamName: string;
    awayTeamName: string;
    kickoffAt: string;
    oddsRows: number;
    confidence: number;
  }>;
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstEnv(env: EnvMap, keys: string[]): string {
  return firstConfiguredEnv(env, keys);
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

function toIsoTimestamp(value: string | null | undefined): string | null {
  const text = cleanText(value);
  if (!text) return null;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function redactedUrl(url: URL, apiKey: string): string {
  const clone = new URL(url.toString());
  if (apiKey && clone.searchParams.get("apiKey") === apiKey) clone.searchParams.set("apiKey", "REDACTED");
  return clone.toString();
}

export function normalizeBasketballTeamName(value: string): string {
  const normalized = cleanText(value)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|nba)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const aliases: Record<string, string> = {
    "la clippers": "los angeles clippers",
    "l a clippers": "los angeles clippers",
    "la lakers": "los angeles lakers",
    "l a lakers": "los angeles lakers",
    "ny knicks": "new york knicks",
    "okc thunder": "oklahoma city thunder",
    "gs warriors": "golden state warriors",
    "golden state": "golden state warriors",
    "san antonio": "san antonio spurs",
    "new orleans": "new orleans pelicans",
    "portland": "portland trail blazers",
    "utah": "utah jazz"
  };

  return aliases[normalized] ?? normalized;
}

function teamNamesMatch(left: string, right: string): boolean {
  const a = normalizeBasketballTeamName(left);
  const b = normalizeBasketballTeamName(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(` ${b}`) || b.endsWith(` ${a}`);
}

function hoursBetween(left: string, right: string): number {
  return Math.abs(Date.parse(left) - Date.parse(right)) / (60 * 60 * 1000);
}

function outcomeSelection(name: string | undefined, event: OddsApiEvent): "home" | "away" | null {
  if (teamNamesMatch(cleanText(name), cleanText(event.home_team))) return "home";
  if (teamNamesMatch(cleanText(name), cleanText(event.away_team))) return "away";
  return null;
}

export function normalizeBasketballOddsEvents(
  response: OddsApiHistoricalResponse,
  { limit }: { limit?: number } = {}
): BasketballOddsEvent[] {
  const events = Array.isArray(response.data) ? response.data : [];
  const timestamp = toIsoTimestamp(response.timestamp) ?? new Date().toISOString();
  return events
    .slice(0, limit && limit > 0 ? limit : undefined)
    .flatMap((event) => {
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
              return (
                market.outcomes?.flatMap((outcome) => {
                  const selection = outcomeSelection(outcome.name, event);
                  if (!selection || typeof outcome.price !== "number" || outcome.price <= 1) return [];
                  return {
                    bookmaker: cleanText(bookmaker.title) || cleanText(bookmaker.key) || "the-odds-api",
                    bookmakerKey: cleanText(bookmaker.key) || null,
                    selection,
                    decimalOdds: outcome.price,
                    observedAt,
                    metadata: {
                      providerEventId,
                      sportKey: cleanText(event.sport_key) || "basketball_nba",
                      marketKey: market.key ?? null,
                      bookmakerKey: bookmaker.key ?? null,
                      snapshotTimestamp: timestamp
                    }
                  } satisfies BasketballOddsQuote;
                }) ?? []
              );
            }) ?? []
        ) ?? [];

      const selections = new Set(quotes.map((quote) => quote.selection));
      if (!selections.has("home") || !selections.has("away")) return [];

      return [
        {
          providerEventId,
          sportKey: cleanText(event.sport_key) || "basketball_nba",
          kickoffAt,
          homeTeamName,
          awayTeamName,
          quotes
        }
      ];
    });
}

export function matchBasketballOddsEventsToFixtures(
  events: BasketballOddsEvent[],
  fixtures: BasketballStoredFixtureCandidate[],
  { maxHours = 36 }: { maxHours?: number } = {}
): { matches: BasketballOddsFixtureMatch[]; unmatchedEvents: BasketballOddsAttachmentResult["unmatchedEvents"] } {
  const matches: BasketballOddsFixtureMatch[] = [];
  const unmatchedEvents: BasketballOddsAttachmentResult["unmatchedEvents"] = [];
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
        reason: "No stored finished basketball fixture matched the same home/away teams within the allowed kickoff window."
      });
      continue;
    }

    usedFixtures.add(best.fixture.fixtureExternalId);
    matches.push({
      event,
      fixture: best.fixture,
      confidence: Number(Math.max(0.72, 0.99 - best.deltaHours / 120).toFixed(3)),
      matchedBy: "teams-and-time"
    });
  }

  return { matches, unmatchedEvents };
}

function marginAdjustedRows(rows: Array<Record<string, unknown> & { implied_probability: number; margin_adjusted_probability: number | null }>) {
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.fixture_external_id}:${row.market}:${row.bookmaker}:${row.is_closing}:${row.observed_at}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }

  for (const groupRows of grouped.values()) {
    const selections = new Set(groupRows.map((row) => row.selection));
    if (!selections.has("home") || !selections.has("away")) continue;
    const margin = groupRows.reduce((sum, row) => sum + row.implied_probability, 0);
    if (margin <= 0) continue;
    for (const row of groupRows) {
      row.margin_adjusted_probability = Number((row.implied_probability / margin).toFixed(6));
    }
  }

  return rows;
}

export function basketballOddsRowsForMatches(matches: BasketballOddsFixtureMatch[], { isClosing = false }: { isClosing?: boolean } = {}) {
  return marginAdjustedRows(
    matches.flatMap((match) =>
      match.event.quotes.map((quote) => ({
        fixture_external_id: match.fixture.fixtureExternalId,
        sport: "basketball",
        provider: "the_odds_api",
        bookmaker: quote.bookmaker,
        market: "match_winner",
        selection: quote.selection,
        decimal_odds: quote.decimalOdds,
        implied_probability: Number((1 / quote.decimalOdds).toFixed(6)),
        margin_adjusted_probability: null,
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
    )
  );
}

async function fetchJson(fetchImpl: FetchLike, url: URL): Promise<{ data?: unknown; error?: string; status: number }> {
  const response = await fetchImpl(url);
  const contentType = response.headers.get("content-type") ?? "";
  const data = contentType.includes("application/json") ? await response.json().catch(() => null) : await response.text().catch(() => "");
  if (!response.ok) {
    if (data && typeof data === "object" && "message" in data) return { data, error: String((data as { message?: unknown }).message), status: response.status };
    return { data, error: `Provider returned HTTP ${response.status}.`, status: response.status };
  }
  return { data, status: response.status };
}

async function readStoredBasketballFixturesForEvents(events: BasketballOddsEvent[]): Promise<BasketballStoredFixtureCandidate[] | { error: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };
  if (!events.length) return [];

  const timestamps = events.map((event) => Date.parse(event.kickoffAt)).filter(Number.isFinite);
  if (!timestamps.length) return [];
  const from = new Date(Math.min(...timestamps) - 36 * 60 * 60 * 1000).toISOString();
  const to = new Date(Math.max(...timestamps) + 36 * 60 * 60 * 1000).toISOString();

  const { data: fixtureRows, error: fixtureError } = await client
    .from("op_fixtures")
    .select("external_id, provider, kickoff_at, home_team_external_id, away_team_external_id")
    .eq("sport", "basketball")
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
    const { data, error } = await client.from("op_teams").select("external_id, name").eq("sport", "basketball").in("external_id", chunk);
    if (error) return { error: error.message };
    teams.push(...((data ?? []) as StoredTeamRow[]));
  }

  const teamNameById = new Map(teams.map((team) => [team.external_id, team.name]));
  return fixtures.flatMap((fixture) => {
    const homeTeamName = teamNameById.get(fixture.home_team_external_id);
    const awayTeamName = teamNameById.get(fixture.away_team_external_id);
    if (!homeTeamName || !awayTeamName) return [];
    return [
      {
        fixtureExternalId: fixture.external_id,
        provider: fixture.provider,
        kickoffAt: new Date(fixture.kickoff_at).toISOString(),
        homeTeamExternalId: fixture.home_team_external_id,
        awayTeamExternalId: fixture.away_team_external_id,
        homeTeamName,
        awayTeamName
      }
    ];
  });
}

async function createIngestionRun(rowsReceived: number, request: BasketballOddsAttachmentRequest) {
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };
  const { data, error } = await client
    .from("op_provider_ingestion_runs")
    .insert({
      provider: "the_odds_api",
      sport: "basketball",
      ingestion_type: "historical_basketball_odds_attachment",
      status: "running",
      started_at: new Date().toISOString(),
      rows_received: rowsReceived,
      metadata: {
        date: request.date,
        regions: request.regions ?? "us",
        bookmakers: request.bookmakers ?? null,
        isClosing: Boolean(request.isClosing)
      }
    })
    .select("id")
    .single();
  if (error) return { error: error.message };
  return { id: String(data.id) };
}

async function finishIngestionRun(id: string, status: "completed" | "failed", rowsWritten: number, errorMessage?: string) {
  const client = getSupabaseServerClient();
  if (!client) return;
  await client
    .from("op_provider_ingestion_runs")
    .update({
      status,
      completed_at: new Date().toISOString(),
      rows_written: rowsWritten,
      error_message: errorMessage ?? null
    })
    .eq("id", id);
}

export async function attachBasketballHistoricalOdds({
  request,
  env = process.env,
  fetchImpl = fetch
}: {
  request: BasketballOddsAttachmentRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
}): Promise<BasketballOddsAttachmentResult> {
  const apiKey = firstEnv(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const endpoint = new URL("https://api.the-odds-api.com/v4/historical/sports/basketball_nba/odds/");
  endpoint.searchParams.set("markets", "h2h");
  endpoint.searchParams.set("oddsFormat", "decimal");
  endpoint.searchParams.set("dateFormat", "iso");
  endpoint.searchParams.set("regions", request.regions?.trim() || "us");
  if (request.bookmakers?.trim()) endpoint.searchParams.set("bookmakers", request.bookmakers.trim());
  // Normalise to the second-precision ISO the v4 historical endpoint expects
  // (strip milliseconds), matching footballOddsAttachment's oddsApiTimestamp.
  if (request.date && Number.isFinite(Date.parse(request.date)))
    endpoint.searchParams.set("date", new Date(request.date).toISOString().replace(/\.\d{3}Z$/, "Z"));
  if (apiKey) endpoint.searchParams.set("apiKey", apiKey);

  const baseResult = {
    configured: Boolean(apiKey),
    dryRun: request.dryRun ?? true,
    provider: "the-odds-api" as const,
    endpoint: redactedUrl(endpoint, apiKey),
    fetched: 0,
    normalizedEvents: 0,
    matchedFixtures: 0,
    oddsRows: 0,
    rowsWritten: 0,
    unmatchedEvents: [],
    sampleMatches: []
  };

  if (!apiKey) {
    return {
      ...baseResult,
      status: "not-configured",
      configured: false,
      reason: "Missing THE_ODDS_API_KEY or ODDS_API_KEY."
    };
  }
  if (!request.date || !isValidIsoTimestamp(request.date)) {
    return {
      ...baseResult,
      status: "failed",
      reason: "Basketball historical odds attachment requires date=ISO_TIMESTAMP."
    };
  }

  const { data, error } = await fetchJson(fetchImpl, endpoint);
  if (error) {
    return {
      ...baseResult,
      status: "provider-error",
      reason: error
    };
  }

  const response = data as OddsApiHistoricalResponse;
  const events = normalizeBasketballOddsEvents(response, { limit: request.limit });
  const fixtureCandidates = await readStoredBasketballFixturesForEvents(events);
  if ("error" in fixtureCandidates) {
    return {
      ...baseResult,
      status: "failed",
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      reason: fixtureCandidates.error
    };
  }

  const { matches, unmatchedEvents } = matchBasketballOddsEventsToFixtures(events, fixtureCandidates);
  const rows = basketballOddsRowsForMatches(matches, { isClosing: Boolean(request.isClosing) });
  const sampleMatches = matches.slice(0, 8).map((match) => ({
    providerEventId: match.event.providerEventId,
    fixtureExternalId: match.fixture.fixtureExternalId,
    homeTeamName: match.fixture.homeTeamName,
    awayTeamName: match.fixture.awayTeamName,
    kickoffAt: match.fixture.kickoffAt,
    oddsRows: match.event.quotes.length,
    confidence: match.confidence
  }));

  if (request.dryRun ?? true) {
    return {
      ...baseResult,
      status: matches.length ? "dry-run" : "no-matches",
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: matches.length,
      oddsRows: rows.length,
      unmatchedEvents,
      sampleMatches,
      reason: matches.length ? undefined : "The provider returned odds, but no events matched stored finished basketball fixtures."
    };
  }

  const runtime = getSupabaseRuntimeStatus(env);
  if (!runtime.serverWriteReady) {
    return {
      ...baseResult,
      status: "not-configured",
      configured: false,
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: matches.length,
      oddsRows: rows.length,
      unmatchedEvents,
      sampleMatches,
      reason: `Supabase server writes are not configured. Missing: ${runtime.missingServerEnv.join(", ")}.`
    };
  }

  if (!matches.length || !rows.length) {
    return {
      ...baseResult,
      status: "no-matches",
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      unmatchedEvents,
      reason: "No confident basketball fixture matches were available for odds attachment."
    };
  }

  const client = getSupabaseServerClient(env);
  if (!client) {
    return {
      ...baseResult,
      status: "failed",
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: matches.length,
      oddsRows: rows.length,
      unmatchedEvents,
      sampleMatches,
      reason: "Supabase client could not be created."
    };
  }

  const ingestionRun = await createIngestionRun(rows.length, request);
  if ("error" in ingestionRun) {
    return {
      ...baseResult,
      status: "failed",
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: matches.length,
      oddsRows: rows.length,
      unmatchedEvents,
      sampleMatches,
      reason: ingestionRun.error
    };
  }

  try {
    const fixtureExternalIds = [...new Set(rows.map((row) => String(row.fixture_external_id)))];
    const observedTimes = [...new Set(rows.map((row) => String(row.observed_at)))];
    for (let index = 0; index < fixtureExternalIds.length; index += 100) {
      const fixtureChunk = fixtureExternalIds.slice(index, index + 100);
      for (let timeIndex = 0; timeIndex < observedTimes.length; timeIndex += 100) {
        const timeChunk = observedTimes.slice(timeIndex, timeIndex + 100);
        const { error: deleteError } = await client
          .from("op_odds_snapshots")
          .delete()
          .eq("sport", "basketball")
          .eq("provider", "the_odds_api")
          .in("fixture_external_id", fixtureChunk)
          .in("observed_at", timeChunk);
        if (deleteError) throw new Error(deleteError.message);
      }
    }

    for (let index = 0; index < rows.length; index += 100) {
      const { error: insertError } = await client.from("op_odds_snapshots").insert(rows.slice(index, index + 100));
      if (insertError) throw new Error(insertError.message);
    }

    const payloadHash = stableHash({ response, matches: sampleMatches, rows: rows.length });
    const { error: rawError } = await client.from("op_raw_provider_payloads").insert({
      ingestion_run_id: ingestionRun.id,
      provider: "the_odds_api",
      sport: "basketball",
      payload_type: "historical_basketball_odds_attachment",
      external_id: `basketball_nba:${request.date}`,
      source_url: redactedUrl(endpoint, apiKey),
      payload: {
        request: {
          date: request.date,
          regions: request.regions ?? "us",
          bookmakers: request.bookmakers ?? null,
          isClosing: Boolean(request.isClosing)
        },
        providerResponse: response,
        matchedFixtures: sampleMatches,
        unmatchedEvents
      },
      payload_hash: payloadHash,
      observed_at: request.date
    });
    if (rawError) throw new Error(rawError.message);

    await finishIngestionRun(ingestionRun.id, "completed", rows.length);
    return {
      ...baseResult,
      status: "stored",
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: matches.length,
      oddsRows: rows.length,
      rowsWritten: rows.length,
      ingestionRunId: ingestionRun.id,
      unmatchedEvents,
      sampleMatches
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Basketball odds attachment failed.";
    await finishIngestionRun(ingestionRun.id, "failed", 0, message);
    return {
      ...baseResult,
      status: "failed",
      fetched: Array.isArray(response.data) ? response.data.length : 0,
      normalizedEvents: events.length,
      matchedFixtures: matches.length,
      oddsRows: rows.length,
      ingestionRunId: ingestionRun.id,
      unmatchedEvents,
      sampleMatches,
      reason: message
    };
  }
}
