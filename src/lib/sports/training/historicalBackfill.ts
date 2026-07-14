import {
  syncHistoricalFootballProvider,
  type ProviderName,
  type ProviderSyncRequest,
  type ProviderSyncResult
} from "./providerSync";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type EnvMap = Record<string, string | undefined>;

type BackfillStatus = "dry-run" | "stored" | "partial" | "not-configured" | "invalid-request" | "provider-error" | "failed";

export type HistoricalProviderBackfillRequest = {
  provider: ProviderName;
  dryRun?: boolean;
  league?: string;
  seasons?: Array<string | number>;
  seasonFrom?: string | number;
  seasonTo?: string | number;
  dates?: string[];
  from?: string;
  to?: string;
  intervalDays?: number;
  sportKey?: string;
  regions?: string;
  bookmakers?: string;
  includeEvents?: boolean;
  includeNews?: boolean;
  includeContext?: boolean;
  includeStandings?: boolean;
  includeAvailability?: boolean;
  includeLineups?: boolean;
  includePlayerStats?: boolean;
  includeWeather?: boolean;
  maxEventFixtures?: number;
  maxContextFixtures?: number;
  limit?: number;
  maxJobs?: number;
  stopOnError?: boolean;
};

export type HistoricalProviderBackfillJob = {
  id: string;
  provider: ProviderName;
  request: ProviderSyncRequest;
  purpose: string;
};

export type HistoricalProviderBackfillPlan = {
  provider: ProviderName;
  dryRun: boolean;
  jobs: HistoricalProviderBackfillJob[];
  totalCandidateJobs: number;
  truncated: boolean;
  errors: string[];
  warnings: string[];
};

export type HistoricalProviderBackfillJobResult = {
  job: HistoricalProviderBackfillJob;
  result: ProviderSyncResult;
};

export type HistoricalProviderBackfillResult = {
  status: BackfillStatus;
  provider: ProviderName;
  dryRun: boolean;
  plannedJobs: number;
  executedJobs: number;
  storedJobs: number;
  dryRunJobs: number;
  failedJobs: number;
  fetched: number;
  normalized: number;
  counts: {
    fixtures: number;
    oddsRows: number;
    eventRows: number;
    newsRows: number;
    standingsRows: number;
    availabilityRows: number;
    lineupRows: number;
    playerPerformanceRows: number;
    playerPerformanceRowsVerified: number;
    weatherRows: number;
    featureSnapshots: number;
  };
  truncated: boolean;
  warnings: string[];
  errors: string[];
  jobs: HistoricalProviderBackfillJobResult[];
};

type SyncImpl = (args: { request: ProviderSyncRequest; env?: EnvMap; fetchImpl?: FetchLike }) => Promise<ProviderSyncResult>;

const DEFAULT_MAX_JOBS = 12;
const HARD_MAX_JOBS = 120;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function uniqueSortedSeasons(seasons: Array<string | number>): string[] {
  return Array.from(
    new Set(
      seasons
        .map((season) => String(season).trim())
        .filter(Boolean)
        .filter((season) => /^\d{4}$/.test(season))
    )
  ).sort();
}

function seasonsFromRange(from: string | number | undefined, to: string | number | undefined): string[] {
  const start = Number(from);
  const end = Number(to);
  if (!Number.isInteger(start) || !Number.isInteger(end)) return [];
  const low = Math.min(start, end);
  const high = Math.max(start, end);
  const seasons: string[] = [];
  for (let season = low; season <= high; season += 1) {
    seasons.push(String(season));
  }
  return seasons;
}

function validIsoDate(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function datesFromRange(from: string | undefined, to: string | undefined, intervalDays: number, maxDates: number): string[] {
  if (!from || !to || !validIsoDate(from) || !validIsoDate(to)) return [];
  const start = new Date(from);
  const end = new Date(to);
  const direction = start <= end ? 1 : -1;
  const dates: string[] = [];
  const cursor = new Date(start);
  while ((direction === 1 && cursor <= end) || (direction === -1 && cursor >= end)) {
    dates.push(cursor.toISOString());
    if (dates.length >= maxDates) break;
    cursor.setUTCDate(cursor.getUTCDate() + intervalDays * direction);
  }
  return dates;
}

function dateWindowsFromRange(
  from: string | undefined,
  to: string | undefined,
  intervalDays: number
): Array<{ from: string; to: string }> {
  if (!from || !to || !validIsoDate(from) || !validIsoDate(to)) return [];
  const left = new Date(from);
  const right = new Date(to);
  const start = left <= right ? left : right;
  const end = left <= right ? right : left;
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const endDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  const windows: Array<{ from: string; to: string }> = [];
  while (cursor <= endDate) {
    const windowStart = new Date(cursor);
    const windowEnd = new Date(Math.min(
      endDate.getTime(),
      windowStart.getTime() + (intervalDays - 1) * 24 * 60 * 60 * 1000
    ));
    windows.push({ from: windowStart.toISOString().slice(0, 10), to: windowEnd.toISOString().slice(0, 10) });
    cursor.setTime(windowEnd.getTime() + 24 * 60 * 60 * 1000);
  }
  return windows;
}

function jobCap(request: HistoricalProviderBackfillRequest): number {
  return boundedInteger(request.maxJobs, DEFAULT_MAX_JOBS, 1, HARD_MAX_JOBS);
}

function commonSyncRequest(request: HistoricalProviderBackfillRequest): Pick<
  ProviderSyncRequest,
  | "dryRun"
  | "includeEvents"
  | "includeNews"
  | "includeContext"
  | "includeStandings"
  | "includeAvailability"
  | "includeLineups"
  | "includePlayerStats"
  | "includeWeather"
  | "maxEventFixtures"
  | "maxContextFixtures"
  | "limit"
> {
  return {
    dryRun: request.dryRun ?? true,
    includeEvents: Boolean(request.includeEvents),
    includeNews: Boolean(request.includeNews),
    includeContext: Boolean(request.includeContext),
    includeStandings: Boolean(request.includeStandings),
    includeAvailability: Boolean(request.includeAvailability),
    includeLineups: Boolean(request.includeLineups),
    includePlayerStats: Boolean(request.includePlayerStats),
    includeWeather: Boolean(request.includeWeather),
    maxEventFixtures: request.maxEventFixtures,
    maxContextFixtures: request.maxContextFixtures,
    limit: request.limit
  };
}

function buildApiFootballJobs(request: HistoricalProviderBackfillRequest): HistoricalProviderBackfillJob[] {
  const league = cleanText(request.league);
  const seasons = uniqueSortedSeasons([...(request.seasons ?? []), ...seasonsFromRange(request.seasonFrom, request.seasonTo)]);
  const windows = dateWindowsFromRange(request.from, request.to, boundedInteger(request.intervalDays, 14, 1, 365));
  return seasons.flatMap((season) => {
    if (!windows.length) {
      return [{
        id: `api-football:${league}:season:${season}`,
        provider: "api-football" as const,
        purpose: `API-Football league ${league} season ${season}`,
        request: {
          provider: "api-football" as const,
          league,
          season,
          ...commonSyncRequest(request)
        }
      }];
    }
    return windows.map((window) => ({
      id: `api-football:${league}:season:${season}:${window.from}:${window.to}`,
      provider: "api-football" as const,
      purpose: `API-Football league ${league} season ${season} from ${window.from} to ${window.to}`,
      request: {
        provider: "api-football" as const,
        league,
        season,
        from: window.from,
        to: window.to,
        ...commonSyncRequest(request)
      }
    }));
  });
}

function buildApiBasketballJobs(request: HistoricalProviderBackfillRequest): HistoricalProviderBackfillJob[] {
  const league = cleanText(request.league);
  const seasons = uniqueSortedSeasons([...(request.seasons ?? []), ...seasonsFromRange(request.seasonFrom, request.seasonTo)]);
  return seasons.map((season) => ({
    id: `api-basketball:${league}:season:${season}`,
    provider: "api-basketball" as const,
    purpose: `API-Basketball league ${league} season ${season}`,
    request: {
      provider: "api-basketball",
      league,
      season,
      ...commonSyncRequest(request)
    }
  }));
}

function buildApiTennisJobs(request: HistoricalProviderBackfillRequest, maxJobs: number): HistoricalProviderBackfillJob[] {
  const explicitDates = (request.dates ?? []).filter((date) => validIsoDate(date));
  const generatedDates = datesFromRange(request.from, request.to, boundedInteger(request.intervalDays, 7, 1, 365), maxJobs);
  const dates = Array.from(new Set([...explicitDates, ...generatedDates])).sort();
  const tournament = cleanText(request.league);

  return dates.map((date) => ({
    id: `api-tennis:${tournament || "all"}:${date}`,
    provider: "api-tennis" as const,
    purpose: `API-Tennis ${tournament || "all tournaments"} events for ${date}`,
    request: {
      provider: "api-tennis",
      league: tournament || undefined,
      date,
      dryRun: request.dryRun ?? true,
      limit: request.limit
    }
  }));
}

function buildTheOddsApiJobs(request: HistoricalProviderBackfillRequest, maxJobs: number): HistoricalProviderBackfillJob[] {
  const explicitDates = (request.dates ?? []).filter((date) => validIsoDate(date));
  const generatedDates = datesFromRange(request.from, request.to, boundedInteger(request.intervalDays, 7, 1, 365), maxJobs);
  const dates = Array.from(new Set([...explicitDates, ...generatedDates])).sort();
  const sportKey = cleanText(request.sportKey) || "soccer_epl";

  return dates.map((date) => ({
    id: `the-odds-api:${sportKey}:${date}`,
    provider: "the-odds-api" as const,
    purpose: `The Odds API ${sportKey} historical odds at ${date}`,
    request: {
      provider: "the-odds-api",
      date,
      sportKey,
      regions: request.regions,
      bookmakers: request.bookmakers,
      dryRun: request.dryRun ?? true,
      limit: request.limit
    }
  }));
}

export function buildHistoricalProviderBackfillPlan(request: HistoricalProviderBackfillRequest): HistoricalProviderBackfillPlan {
  const dryRun = request.dryRun ?? true;
  const maxJobs = jobCap(request);
  const warnings: string[] = [];
  const errors: string[] = [];
  let jobs: HistoricalProviderBackfillJob[] = [];

  if (request.provider === "api-football") {
    if (!cleanText(request.league)) errors.push("league is required for API-Football backfills.");
    jobs = buildApiFootballJobs(request);
    if (!jobs.length) errors.push("At least one season or season range is required for API-Football backfills.");
    if (request.includeContext && request.includeWeather && !request.includeEvents) {
      warnings.push("Weather context can be archived without events, but event snapshots usually make the football corpus more useful.");
    }
  } else if (request.provider === "api-basketball") {
    if (!cleanText(request.league)) errors.push("league is required for API-Basketball backfills.");
    jobs = buildApiBasketballJobs(request);
    if (!jobs.length) errors.push("At least one season or season range is required for API-Basketball backfills.");
  } else if (request.provider === "api-tennis") {
    jobs = buildApiTennisJobs(request, maxJobs);
    if (!jobs.length) errors.push("At least one valid ISO date or date range is required for API-Tennis backfills.");
  } else if (request.provider === "the-odds-api") {
    jobs = buildTheOddsApiJobs(request, maxJobs);
    if (!jobs.length) errors.push("At least one valid ISO date or date range is required for The Odds API backfills.");
  } else {
    errors.push("provider must be api-football, api-basketball, api-tennis, or the-odds-api.");
  }

  const totalCandidateJobs = jobs.length;
  const limitedJobs = jobs.slice(0, maxJobs);
  const truncated = totalCandidateJobs > limitedJobs.length;
  if (truncated) warnings.push(`Backfill plan was capped at ${maxJobs} job(s); raise maxJobs intentionally to continue.`);
  if (!dryRun) warnings.push("dryRun=0 will write normalized rows through the server Supabase client when env is configured.");

  return {
    provider: request.provider,
    dryRun,
    jobs: errors.length ? [] : limitedJobs,
    totalCandidateJobs,
    truncated,
    errors,
    warnings
  };
}

function emptyCounts(): HistoricalProviderBackfillResult["counts"] {
  return {
    fixtures: 0,
    oddsRows: 0,
    eventRows: 0,
    newsRows: 0,
    standingsRows: 0,
    availabilityRows: 0,
    lineupRows: 0,
    playerPerformanceRows: 0,
    playerPerformanceRowsVerified: 0,
    weatherRows: 0,
    featureSnapshots: 0
  };
}

function statusForResults({
  dryRun,
  errors,
  executedJobs,
  storedJobs,
  dryRunJobs,
  failedJobs,
  jobResults
}: {
  dryRun: boolean;
  errors: string[];
  executedJobs: number;
  storedJobs: number;
  dryRunJobs: number;
  failedJobs: number;
  jobResults: HistoricalProviderBackfillJobResult[];
}): BackfillStatus {
  if (errors.length && !executedJobs) return "invalid-request";
  if (!executedJobs) return "failed";
  if (failedJobs && (storedJobs || dryRunJobs)) return "partial";
  if (failedJobs) {
    if (jobResults.some(({ result }) => result.status === "not-configured")) return "not-configured";
    if (jobResults.some(({ result }) => result.status === "provider-error" || result.status === "invalid-response")) return "provider-error";
    return "failed";
  }
  if (storedJobs) return "stored";
  if (dryRun || dryRunJobs) return "dry-run";
  return "failed";
}

export async function runHistoricalProviderBackfill({
  request,
  env = process.env,
  fetchImpl = fetch,
  syncImpl = syncHistoricalFootballProvider
}: {
  request: HistoricalProviderBackfillRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
  syncImpl?: SyncImpl;
}): Promise<HistoricalProviderBackfillResult> {
  const plan = buildHistoricalProviderBackfillPlan(request);
  const counts = emptyCounts();
  const jobResults: HistoricalProviderBackfillJobResult[] = [];
  const errors = [...plan.errors];
  let fetched = 0;
  let normalized = 0;
  let storedJobs = 0;
  let dryRunJobs = 0;
  let failedJobs = 0;

  for (const job of plan.jobs) {
    const result = await syncImpl({ request: job.request, env, fetchImpl });
    jobResults.push({ job, result });
    fetched += result.fetched;
    normalized += result.normalized;
    counts.fixtures += result.ingestion?.counts.fixtures ?? 0;
    counts.oddsRows += result.ingestion?.counts.oddsRows ?? 0;
    counts.eventRows += result.ingestion?.counts.eventRows ?? 0;
    counts.newsRows += result.ingestion?.counts.newsRows ?? 0;
    counts.standingsRows += result.ingestion?.counts.standingsRows ?? 0;
    counts.availabilityRows += result.ingestion?.counts.availabilityRows ?? 0;
    counts.lineupRows += result.ingestion?.counts.lineupRows ?? 0;
    counts.playerPerformanceRows += result.dryRun
      ? result.playerPerformancesNormalized ?? 0
      : result.playerPerformancesStored ?? 0;
    counts.playerPerformanceRowsVerified += result.playerPerformancesVerified ?? 0;
    counts.weatherRows += result.ingestion?.counts.weatherRows ?? 0;
    counts.featureSnapshots += result.ingestion?.counts.featureSnapshots ?? 0;

    if (result.status === "stored") storedJobs += 1;
    else if (result.status === "dry-run") dryRunJobs += 1;
    else {
      failedJobs += 1;
      errors.push(`${job.id}: ${result.reason ?? result.status}`);
      if (request.stopOnError) break;
    }
  }

  const executedJobs = jobResults.length;

  return {
    status: statusForResults({
      dryRun: plan.dryRun,
      errors,
      executedJobs,
      storedJobs,
      dryRunJobs,
      failedJobs,
      jobResults
    }),
    provider: plan.provider,
    dryRun: plan.dryRun,
    plannedJobs: plan.jobs.length,
    executedJobs,
    storedJobs,
    dryRunJobs,
    failedJobs,
    fetched,
    normalized,
    counts,
    truncated: plan.truncated,
    warnings: plan.warnings,
    errors,
    jobs: jobResults
  };
}
