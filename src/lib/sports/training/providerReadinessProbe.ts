import { firstConfiguredEnv } from "@/lib/env";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { syncHistoricalFootballProvider, type ProviderSyncRequest, type ProviderSyncResult } from "./providerSync";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type SyncImpl = (args: { request: ProviderSyncRequest; env?: EnvMap; fetchImpl?: FetchLike }) => Promise<ProviderSyncResult>;

export type ProviderReadinessProbeStatus = "ready" | "watch" | "blocked";
export type ProviderReadinessFeedStatus = "pass" | "watch" | "block" | "skipped";
export type ProviderReadinessFeedId = "fixtures" | "events" | "standings" | "availability" | "suspensions" | "lineups" | "news" | "weather";

export type ProviderReadinessFeedCheck = {
  id: ProviderReadinessFeedId;
  label: string;
  status: ProviderReadinessFeedStatus;
  fetched: number | null;
  normalized: number | null;
  evidence: string;
  nextAction: string;
};

export type ProviderReadinessProbeRequest = {
  provider?: "api-football";
  league?: string;
  season?: string;
  date?: string;
  from?: string;
  to?: string;
  includeEvents?: boolean;
  includeContext?: boolean;
  includeStandings?: boolean;
  includeAvailability?: boolean;
  includeLineups?: boolean;
  includeNews?: boolean;
  includeWeather?: boolean;
  limit?: number;
};

export type OddsProviderReadinessProbeRequest = {
  provider?: "the-odds-api";
  sportKey?: string;
  date?: string;
  regions?: string;
  bookmakers?: string;
  limit?: number;
};

export type ProviderReadinessProbe = {
  generatedAt: string;
  status: ProviderReadinessProbeStatus;
  provider: "api-football";
  dryRun: true;
  request: Required<Pick<ProviderReadinessProbeRequest, "provider" | "league" | "season" | "limit">> &
    Omit<ProviderReadinessProbeRequest, "provider" | "league" | "season" | "limit">;
  configured: boolean;
  endpoint: string | null;
  checks: ProviderReadinessFeedCheck[];
  summary: string;
  blockers: string[];
  watchItems: string[];
  canRunFirstBackfillDryRun: boolean;
  firstBackfillDryRunCommand: string;
  proof: {
    syncStatus: ProviderSyncResult["status"];
    fetched: number;
    normalized: number;
    reason: string | null;
  };
};

export type OddsProviderReadinessProbeCheckId = "credential" | "request" | "bookmaker-odds" | "normalization" | "storage-safety";

export type OddsProviderReadinessProbeCheck = {
  id: OddsProviderReadinessProbeCheckId;
  label: string;
  status: ProviderReadinessFeedStatus;
  evidence: string;
  nextAction: string;
};

export type OddsProviderReadinessProbe = {
  generatedAt: string;
  status: ProviderReadinessProbeStatus;
  provider: "the-odds-api";
  dryRun: true;
  request: Required<Pick<OddsProviderReadinessProbeRequest, "provider" | "sportKey" | "date" | "regions" | "limit">> &
    Pick<OddsProviderReadinessProbeRequest, "bookmakers">;
  configured: boolean;
  endpoint: string | null;
  checks: OddsProviderReadinessProbeCheck[];
  summary: string;
  blockers: string[];
  watchItems: string[];
  canRunFirstOddsDryRun: boolean;
  firstOddsDryRunCommand: string;
  proof: {
    syncStatus: ProviderSyncResult["status"];
    fetched: number;
    normalized: number;
    reason: string | null;
  };
};

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstEnv(env: EnvMap, keys: string[]): string {
  return firstConfiguredEnv(env, keys);
}

function commandBaseUrl(baseUrl: string | undefined): string {
  return baseUrl?.trim().replace(/\/$/, "") || decisionSiteOrigin();
}

function defaultRequest(request: ProviderReadinessProbeRequest = {}): ProviderSyncRequest {
  return {
    provider: "api-football",
    dryRun: true,
    league: cleanText(request.league) || "39",
    season: cleanText(request.season) || "2025",
    date: cleanText(request.date) || undefined,
    from: cleanText(request.from) || undefined,
    to: cleanText(request.to) || undefined,
    includeEvents: request.includeEvents ?? true,
    includeContext: request.includeContext ?? true,
    includeStandings: request.includeStandings ?? true,
    includeAvailability: request.includeAvailability ?? true,
    includeLineups: request.includeLineups ?? true,
    includeNews: request.includeNews ?? false,
    includeWeather: request.includeWeather ?? false,
    limit: Math.min(Math.max(Math.trunc(request.limit ?? 1), 1), 5)
  };
}

function defaultOddsRequest(request: OddsProviderReadinessProbeRequest = {}): ProviderSyncRequest {
  const date = cleanText(request.date);
  return {
    provider: "the-odds-api",
    dryRun: true,
    sportKey: cleanText(request.sportKey) || "soccer_epl",
    date: date.includes("T") ? date : `${date || new Date().toISOString().slice(0, 10)}T12:00:00Z`,
    regions: cleanText(request.regions) || "uk,eu",
    bookmakers: cleanText(request.bookmakers) || undefined,
    limit: Math.min(Math.max(Math.trunc(request.limit ?? 5), 1), 25)
  };
}

function feedCheck({
  id,
  label,
  requested,
  fetched,
  normalized,
  errors,
  blocked,
  missingOptional
}: {
  id: ProviderReadinessFeedId;
  label: string;
  requested: boolean;
  fetched?: number;
  normalized?: number;
  errors?: string[];
  blocked?: string;
  missingOptional?: string;
}): ProviderReadinessFeedCheck {
  if (!requested) {
    return {
      id,
      label,
      status: "skipped",
      fetched: null,
      normalized: null,
      evidence: "This feed was not requested for the readiness probe.",
      nextAction: `Set include${label.replace(/[^A-Za-z]/g, "")}=1 when this feed is needed.`
    };
  }

  if (missingOptional) {
    return {
      id,
      label,
      status: "watch",
      fetched: 0,
      normalized: 0,
      evidence: missingOptional,
      nextAction: "Add the optional feed key before requiring this signal in model trust."
    };
  }

  if (blocked || errors?.length) {
    return {
      id,
      label,
      status: "block",
      fetched: fetched ?? 0,
      normalized: normalized ?? 0,
      evidence: blocked ?? errors?.[0] ?? "Provider feed returned an error.",
      nextAction: "Fix the provider key, request parameters, quota, or provider response before backfill."
    };
  }

  if ((normalized ?? 0) > 0 || (fetched ?? 0) > 0) {
    return {
      id,
      label,
      status: "pass",
      fetched: fetched ?? 0,
      normalized: normalized ?? 0,
      evidence: `${label} endpoint responded with ${fetched ?? 0} fetched and ${normalized ?? 0} normalized row(s).`,
      nextAction: "Keep this feed in the first dry-run and inspect normalized payload quality."
    };
  }

  return {
    id,
    label,
    status: "watch",
    fetched: fetched ?? 0,
    normalized: normalized ?? 0,
    evidence: `${label} endpoint responded but did not return rows for this sample fixture.`,
    nextAction: "Try a finished fixture or a nearer kickoff before treating the feed as unavailable."
  };
}

function firstBackfillCommand(baseUrl: string, request: ProviderSyncRequest): string {
  const query = new URLSearchParams();
  query.set("provider", "api-football");
  if (request.league) query.set("league", request.league);
  if (request.season) {
    query.set("seasonFrom", request.season);
    query.set("seasonTo", request.season);
  }
  query.set("includeEvents", request.includeEvents ? "1" : "0");
  query.set("includeContext", request.includeContext ? "1" : "0");
  query.set("includeStandings", request.includeStandings ? "1" : "0");
  query.set("includeAvailability", request.includeAvailability ? "1" : "0");
  query.set("includeLineups", request.includeLineups ? "1" : "0");
  if (request.includeNews) query.set("includeNews", "1");
  if (request.includeWeather) query.set("includeWeather", "1");
  query.set("maxJobs", "1");
  query.set("dryRun", "1");
  return `curl.exe -X POST "${baseUrl}/api/sports/decision/training/backfill?${query.toString()}" -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
}

function firstOddsDryRunCommand(baseUrl: string, request: ProviderSyncRequest): string {
  const query = new URLSearchParams();
  query.set("provider", "the-odds-api");
  query.set("sportKey", request.sportKey ?? "soccer_epl");
  if (request.date) query.set("date", request.date);
  if (request.regions) query.set("regions", request.regions);
  if (request.bookmakers) query.set("bookmakers", request.bookmakers);
  query.set("limit", String(request.limit ?? 5));
  query.set("dryRun", "1");
  return `curl.exe -X POST "${baseUrl}/api/sports/decision/training/provider-sync?${query.toString()}" -H "x-oddspadi-admin-token: $env:ODDSPADI_ADMIN_TOKEN"`;
}

function oddsCheck(input: OddsProviderReadinessProbeCheck): OddsProviderReadinessProbeCheck {
  return input;
}

export async function buildTheOddsApiProviderReadinessProbe({
  request = {},
  env = process.env,
  fetchImpl = fetch,
  syncImpl = syncHistoricalFootballProvider,
  baseUrl,
  generatedAt = new Date().toISOString()
}: {
  request?: OddsProviderReadinessProbeRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
  syncImpl?: SyncImpl;
  baseUrl?: string;
  generatedAt?: string;
} = {}): Promise<OddsProviderReadinessProbe> {
  const syncRequest = defaultOddsRequest(request);
  const apiKey = firstEnv(env, ["THE_ODDS_API_KEY", "ODDS_API_KEY"]);
  const result = await syncImpl({ request: syncRequest, env, fetchImpl });
  const credentialReady = Boolean(apiKey);
  const dateReady = Boolean(syncRequest.date);
  const oddsRowsReady = result.normalized > 0;
  const fetchedRows = result.fetched > 0;
  const resultError =
    result.status === "provider-error" || result.status === "failed" || result.status === "invalid-response"
      ? result.reason ?? "The Odds API probe failed."
      : null;
  const checks: OddsProviderReadinessProbeCheck[] = [
    oddsCheck({
      id: "credential",
      label: "Odds provider credential",
      status: credentialReady ? "pass" : "block",
      evidence: credentialReady ? "THE_ODDS_API_KEY or ODDS_API_KEY is configured." : "Missing THE_ODDS_API_KEY or ODDS_API_KEY.",
      nextAction: credentialReady ? "Keep the key server-only and reuse it for dry-run odds probes." : "Add a server-only The Odds API key before odds readiness can pass."
    }),
    oddsCheck({
      id: "request",
      label: "Historical odds request",
      status: dateReady && !resultError ? "pass" : "block",
      evidence: resultError ?? `sportKey=${syncRequest.sportKey}; date=${syncRequest.date}; regions=${syncRequest.regions}.`,
      nextAction: dateReady ? "Keep the first probe narrow: one sport key, one timestamp, capped rows." : "Provide date=ISO_TIMESTAMP for the historical odds endpoint."
    }),
    oddsCheck({
      id: "bookmaker-odds",
      label: "Bookmaker odds",
      status: oddsRowsReady ? "pass" : fetchedRows ? "watch" : credentialReady && !resultError ? "watch" : "block",
      evidence: oddsRowsReady
        ? `The Odds API returned ${result.fetched} event(s) and ${result.normalized} normalized odds row(s).`
        : fetchedRows
          ? `The Odds API returned ${result.fetched} event(s), but no normalized h2h odds rows.`
          : result.reason ?? "No bookmaker odds rows were returned for this sample.",
      nextAction: oddsRowsReady
        ? "Inspect bookmaker, market, selection, decimal odds, and timestamps before write-mode imports."
        : "Try a different timestamp, sport key, region, or bookmaker filter before treating odds coverage as unavailable."
    }),
    oddsCheck({
      id: "normalization",
      label: "No-vig normalization inputs",
      status: oddsRowsReady ? "pass" : fetchedRows ? "watch" : "block",
      evidence: oddsRowsReady
        ? "Normalized rows can feed implied probability, margin removal, EV, and CLV calculations."
        : "No normalized selection rows are available for implied-probability and no-vig checks.",
      nextAction: oddsRowsReady ? "Run odds-intelligence proof after matching odds to fixtures." : "Confirm the provider response includes h2h markets with home/away prices."
    }),
    oddsCheck({
      id: "storage-safety",
      label: "Dry-run storage safety",
      status: result.dryRun ? "pass" : "block",
      evidence: result.dryRun ? "Probe is dry-run-only and does not persist odds rows." : "Probe was not executed in dry-run mode.",
      nextAction: "Keep write imports locked until Supabase project, schema, service key, and MCP proof pass."
    })
  ];
  const blockers = checks.filter((check) => check.status === "block").map((check) => `${check.label}: ${check.evidence}`);
  const watchItems = checks.filter((check) => check.status === "watch").map((check) => `${check.label}: ${check.evidence}`);
  const status: ProviderReadinessProbeStatus = blockers.length ? "blocked" : watchItems.length ? "watch" : "ready";
  const origin = commandBaseUrl(baseUrl);

  return {
    generatedAt,
    status,
    provider: "the-odds-api",
    dryRun: true,
    request: {
      provider: "the-odds-api",
      sportKey: syncRequest.sportKey ?? "soccer_epl",
      date: syncRequest.date ?? "",
      regions: syncRequest.regions ?? "uk,eu",
      bookmakers: syncRequest.bookmakers,
      limit: syncRequest.limit ?? 5
    },
    configured: credentialReady,
    endpoint: result.endpoint,
    checks,
    summary:
      status === "ready"
        ? "The Odds API is ready for the first bookmaker odds dry-run: priced rows are normalized and storage remains locked."
        : status === "watch"
          ? `The Odds API key/request can run, with ${watchItems.length} market coverage issue(s) needing review.`
          : `The Odds API readiness is blocked by ${blockers.length} issue(s).`,
    blockers,
    watchItems,
    canRunFirstOddsDryRun: credentialReady && oddsRowsReady && !blockers.length,
    firstOddsDryRunCommand: firstOddsDryRunCommand(origin, syncRequest),
    proof: {
      syncStatus: result.status,
      fetched: result.fetched,
      normalized: result.normalized,
      reason: result.reason ?? null
    }
  };
}

export async function buildApiFootballProviderReadinessProbe({
  request = {},
  env = process.env,
  fetchImpl = fetch,
  syncImpl = syncHistoricalFootballProvider,
  baseUrl,
  generatedAt = new Date().toISOString()
}: {
  request?: ProviderReadinessProbeRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
  syncImpl?: SyncImpl;
  baseUrl?: string;
  generatedAt?: string;
} = {}): Promise<ProviderReadinessProbe> {
  const syncRequest = defaultRequest(request);
  const apiKey = firstEnv(env, ["API_FOOTBALL_KEY", "APISPORTS_KEY", "SPORTS_API_KEY"]);
  const newsKey = firstEnv(env, ["NEWS_API_KEY"]);
  const weatherKey = firstEnv(env, ["WEATHER_API_KEY", "OPENWEATHER_API_KEY"]);
  const result = await syncImpl({ request: syncRequest, env, fetchImpl });
  const fixtureBlocked =
    result.status === "not-configured"
      ? "Missing API_FOOTBALL_KEY, APISPORTS_KEY, or SPORTS_API_KEY."
      : result.status === "provider-error" || result.status === "failed" || result.status === "invalid-response"
        ? result.reason ?? "API-Football fixture probe failed."
        : undefined;

  const checks: ProviderReadinessFeedCheck[] = [
    feedCheck({
      id: "fixtures",
      label: "Fixtures",
      requested: true,
      fetched: result.fetched,
      normalized: result.normalized,
      blocked: fixtureBlocked
    }),
    feedCheck({
      id: "events",
      label: "Events",
      requested: Boolean(syncRequest.includeEvents),
      fetched: result.eventFetched,
      normalized: result.eventNormalized,
      errors: result.eventErrors
    }),
    feedCheck({
      id: "standings",
      label: "Standings",
      requested: Boolean(syncRequest.includeContext || syncRequest.includeStandings),
      fetched: result.standingsFetched,
      normalized: result.standingsNormalized,
      errors: result.standingsErrors
    }),
    feedCheck({
      id: "availability",
      label: "Availability",
      requested: Boolean(syncRequest.includeContext || syncRequest.includeAvailability),
      fetched: result.availabilityFetched,
      normalized: result.availabilityNormalized,
      errors: result.availabilityErrors
    }),
    feedCheck({
      id: "suspensions",
      label: "Suspensions",
      requested: Boolean(syncRequest.includeContext || syncRequest.includeAvailability),
      fetched: result.availabilityFetched,
      normalized: result.availabilityNormalized,
      errors: result.availabilityErrors
    }),
    feedCheck({
      id: "lineups",
      label: "Lineups",
      requested: Boolean(syncRequest.includeContext || syncRequest.includeLineups),
      fetched: result.lineupsFetched,
      normalized: result.lineupsNormalized,
      errors: result.lineupsErrors
    }),
    feedCheck({
      id: "news",
      label: "News",
      requested: Boolean(syncRequest.includeNews),
      fetched: result.newsFetched,
      normalized: result.newsNormalized,
      errors: result.newsErrors,
      missingOptional: syncRequest.includeNews && !newsKey ? "Missing NEWS_API_KEY." : undefined
    }),
    feedCheck({
      id: "weather",
      label: "Weather",
      requested: Boolean(syncRequest.includeContext || syncRequest.includeWeather) && Boolean(syncRequest.includeWeather),
      fetched: result.weatherFetched,
      normalized: result.weatherNormalized,
      errors: result.weatherErrors,
      missingOptional: syncRequest.includeWeather && !weatherKey ? "Missing WEATHER_API_KEY or OPENWEATHER_API_KEY." : undefined
    })
  ];
  const blockers = checks.filter((check) => check.status === "block").map((check) => `${check.label}: ${check.evidence}`);
  const watchItems = checks.filter((check) => check.status === "watch").map((check) => `${check.label}: ${check.evidence}`);
  const fixturePasses = checks.find((check) => check.id === "fixtures")?.status === "pass";
  const status: ProviderReadinessProbeStatus = blockers.length ? "blocked" : watchItems.length ? "watch" : "ready";
  const canRunFirstBackfillDryRun = Boolean(apiKey && fixturePasses && !blockers.length);
  const origin = commandBaseUrl(baseUrl);

  return {
    generatedAt,
    status,
    provider: "api-football",
    dryRun: true,
    request: {
      provider: "api-football",
      league: syncRequest.league ?? "39",
      season: syncRequest.season ?? "2025",
      limit: syncRequest.limit ?? 1,
      date: syncRequest.date,
      from: syncRequest.from,
      to: syncRequest.to,
      includeEvents: syncRequest.includeEvents,
      includeContext: syncRequest.includeContext,
      includeStandings: syncRequest.includeStandings,
      includeAvailability: syncRequest.includeAvailability,
      includeLineups: syncRequest.includeLineups,
      includeNews: syncRequest.includeNews,
      includeWeather: syncRequest.includeWeather
    },
    configured: Boolean(apiKey),
    endpoint: result.endpoint,
    checks,
    summary:
      status === "ready"
        ? "API-Football fixture and requested context feeds are ready for the first dry-run."
        : status === "watch"
          ? `API-Football fixture probe can proceed, with ${watchItems.length} feed(s) needing sample review.`
          : `API-Football provider readiness is blocked by ${blockers.length} feed issue(s).`,
    blockers,
    watchItems,
    canRunFirstBackfillDryRun,
    firstBackfillDryRunCommand: firstBackfillCommand(origin, syncRequest),
    proof: {
      syncStatus: result.status,
      fetched: result.fetched,
      normalized: result.normalized,
      reason: result.reason ?? null
    }
  };
}
