import type { HistoricalFootballFixtureInput } from "./historicalIngestion";
import { getSupabaseRuntimeStatus, getSupabaseServerClient } from "@/lib/supabase/server";
import {
  attachFootballHistoricalOdds,
  DEFAULT_FOOTBALL_CLOSING_WINDOW_MINUTES,
  type FootballOddsAttachmentRequest,
  type FootballOddsAttachmentResult
} from "./footballOddsAttachment";
import {
  readStoredFootballProviderFixtures,
  type StoredFootballProviderFixtures
} from "./footballProviderFeatureCorpusRepository";

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type EnvMap = Record<string, string | undefined>;
type BackfillStatus = "planned" | "dry-run" | "stored" | "partial" | "no-matches" | "not-configured" | "invalid-request" | "failed";

export type FootballHistoricalOddsBackfillMode = "opening" | "closing" | "both";

export type FootballHistoricalOddsBackfillRequest = {
  execute?: boolean;
  dryRun?: boolean;
  fixtureProvider?: string;
  season?: string;
  leagueExternalId?: string;
  sportKey?: string;
  regions?: string;
  bookmakers?: string;
  mode?: FootballHistoricalOddsBackfillMode;
  fixtureLimit?: number;
  batchLimit?: number;
  eventLimit?: number;
  maxJobs?: number;
  offset?: number;
  openingLeadHours?: number;
  closingLeadMinutes?: number;
  closingWindowMinutes?: number;
  stopOnError?: boolean;
};

export type FootballHistoricalOddsBackfillJob = {
  id: string;
  mode: Exclude<FootballHistoricalOddsBackfillMode, "both">;
  groupKey: string;
  purpose: string;
  snapshotAt: string;
  kickoffFrom: string;
  kickoffTo: string;
  fixtureExternalIds: string[];
  request: FootballOddsAttachmentRequest;
};

export type FootballHistoricalOddsBackfillPlan = {
  mode: FootballHistoricalOddsBackfillMode;
  execute: boolean;
  dryRun: boolean;
  fixtureProvider: string;
  fixtureCount: number;
  totalGeneratedJobs: number;
  totalCandidateJobs: number;
  completedJobs: number;
  remainingCandidateJobs: number;
  checkpointRows: number;
  skippedBeforeCoverage: number;
  offset: number;
  maxJobs: number;
  jobs: FootballHistoricalOddsBackfillJob[];
  nextOffset: number | null;
  truncated: boolean;
  estimatedCreditsPerJob: number;
  estimatedCredits: number;
  totalEstimatedCredits: number;
  earliestHistoricalSnapshot: string;
  warnings: string[];
  errors: string[];
};

export type FootballHistoricalOddsBackfillJobResult = {
  job: FootballHistoricalOddsBackfillJob;
  result: FootballOddsAttachmentResult;
};

export type FootballHistoricalOddsBackfillResult = {
  status: BackfillStatus;
  execute: boolean;
  dryRun: boolean;
  source: StoredFootballProviderFixtures["source"] | null;
  plan: FootballHistoricalOddsBackfillPlan;
  executedJobs: number;
  storedJobs: number;
  dryRunJobs: number;
  noMatchJobs: number;
  failedJobs: number;
  fetchedEvents: number;
  matchedFixtures: number;
  closingRejectedFixtures: number;
  oddsRows: number;
  rowsWritten: number;
  estimatedCreditsConsumed: number;
  warnings: string[];
  errors: string[];
  jobs: FootballHistoricalOddsBackfillJobResult[];
};

type CorpusReader = (input: {
  provider?: string;
  limit?: number;
  batchLimit?: number;
  season?: string;
  leagueExternalId?: string;
}) => Promise<StoredFootballProviderFixtures | { error: string }>;

type AttachmentRunner = (input: {
  request: FootballOddsAttachmentRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
}) => Promise<FootballOddsAttachmentResult>;

type CompletionReader = (input: {
  sportKey: string;
  fixtureProvider: string;
}) => Promise<{ keys: string[]; rows: number } | { error: string }>;

export const THE_ODDS_API_EPL_HISTORICAL_START = "2020-06-06T10:05:00Z";
const DEFAULT_MAX_JOBS = 10;
const HARD_MAX_JOBS = 100;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function validFixture(fixture: HistoricalFootballFixtureInput): boolean {
  return Boolean(
    cleanText(fixture.externalId) &&
      Number.isFinite(Date.parse(fixture.kickoffAt)) &&
      fixture.status === "finished"
  );
}

function normalizedMode(value: FootballHistoricalOddsBackfillMode | undefined): FootballHistoricalOddsBackfillMode {
  return value === "opening" || value === "closing" || value === "both" ? value : "both";
}

function isoWithoutMilliseconds(timestamp: number): string {
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function utcDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "group";
}

function groupedFixtures(
  fixtures: HistoricalFootballFixtureInput[],
  keyFor: (fixture: HistoricalFootballFixtureInput) => string
): Array<{ key: string; fixtures: HistoricalFootballFixtureInput[] }> {
  const groups = new Map<string, HistoricalFootballFixtureInput[]>();
  for (const fixture of fixtures) {
    const key = keyFor(fixture);
    groups.set(key, [...(groups.get(key) ?? []), fixture]);
  }
  return [...groups.entries()].map(([key, group]) => ({
    key,
    fixtures: group.sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt))
  }));
}

function requestForJob(
  request: FootballHistoricalOddsBackfillRequest,
  snapshotAt: string,
  isClosing: boolean
): FootballOddsAttachmentRequest {
  return {
    date: snapshotAt,
    dryRun: request.dryRun ?? true,
    limit: boundedInteger(request.eventLimit, 200, 1, 200),
    regions: cleanText(request.regions) || "uk",
    bookmakers: cleanText(request.bookmakers) || undefined,
    isClosing,
    closingWindowMinutes: boundedInteger(
      request.closingWindowMinutes,
      DEFAULT_FOOTBALL_CLOSING_WINDOW_MINUTES,
      5,
      360
    ),
    sportKey: cleanText(request.sportKey) || "soccer_epl",
    fixtureProvider: cleanText(request.fixtureProvider) || "api_football"
  };
}

function buildOpeningJobs(
  fixtures: HistoricalFootballFixtureInput[],
  request: FootballHistoricalOddsBackfillRequest
): FootballHistoricalOddsBackfillJob[] {
  const leadHours = boundedInteger(request.openingLeadHours, 24, 1, 168);
  return groupedFixtures(fixtures, (fixture) => {
    const season = cleanText(fixture.season) || "unknown-season";
    const round = cleanText(fixture.round) || `date-${utcDate(fixture.kickoffAt)}`;
    return `${season}:${round}`;
  }).map((group) => {
    const kickoffFrom = group.fixtures[0]!.kickoffAt;
    const kickoffTo = group.fixtures[group.fixtures.length - 1]!.kickoffAt;
    const snapshotAt = isoWithoutMilliseconds(Date.parse(kickoffFrom) - leadHours * 60 * 60 * 1000);
    return {
      id: `football-odds:opening:${safeId(group.key)}:${snapshotAt}`,
      mode: "opening" as const,
      groupKey: group.key,
      purpose: `Pre-match market reference ${leadHours} hour(s) before the first kickoff in ${group.key}`,
      snapshotAt,
      kickoffFrom,
      kickoffTo,
      fixtureExternalIds: group.fixtures.map((fixture) => fixture.externalId),
      request: requestForJob(request, snapshotAt, false)
    };
  });
}

function buildClosingJobs(
  fixtures: HistoricalFootballFixtureInput[],
  request: FootballHistoricalOddsBackfillRequest
): FootballHistoricalOddsBackfillJob[] {
  const leadMinutes = boundedInteger(request.closingLeadMinutes, 15, 5, 90);
  return groupedFixtures(fixtures, (fixture) => new Date(fixture.kickoffAt).toISOString()).map((group) => {
    const kickoffFrom = group.fixtures[0]!.kickoffAt;
    const kickoffTo = group.fixtures[group.fixtures.length - 1]!.kickoffAt;
    const snapshotAt = isoWithoutMilliseconds(Date.parse(kickoffFrom) - leadMinutes * 60 * 1000);
    return {
      id: `football-odds:closing:${snapshotAt}`,
      mode: "closing" as const,
      groupKey: group.key,
      purpose: `Near-close market snapshot ${leadMinutes} minute(s) before kickoff`,
      snapshotAt,
      kickoffFrom,
      kickoffTo,
      fixtureExternalIds: group.fixtures.map((fixture) => fixture.externalId),
      request: requestForJob(request, snapshotAt, true)
    };
  });
}

function quotaUnits(request: FootballHistoricalOddsBackfillRequest): number {
  const bookmakers = cleanText(request.bookmakers)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (bookmakers.length) return Math.max(1, Math.ceil(new Set(bookmakers).size / 10));
  const regions = (cleanText(request.regions) || "uk")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return Math.max(1, new Set(regions).size);
}

export function footballHistoricalOddsCheckpointKey(mode: "opening" | "closing", snapshotAt: string): string {
  return `${mode}:${isoWithoutMilliseconds(Date.parse(snapshotAt))}`;
}

export async function readStoredFootballOddsBackfillCheckpoints({
  sportKey,
  fixtureProvider
}: {
  sportKey: string;
  fixtureProvider: string;
}): Promise<{ keys: string[]; rows: number } | { error: string }> {
  const runtime = getSupabaseRuntimeStatus();
  if (!runtime.serverWriteReady) {
    return { error: `Supabase server reads are not configured for OddsPadi. Missing: ${runtime.missingServerEnv.join(", ")}.` };
  }
  const client = getSupabaseServerClient();
  if (!client) return { error: "Supabase client could not be created." };

  const keys = new Set<string>();
  let rows = 0;
  const pageSize = 1000;
  for (let pageFrom = 0; ; pageFrom += pageSize) {
    const { data, error } = await client
      .from("op_raw_provider_payloads")
      .select("id, request:payload->request")
      .eq("provider", "the_odds_api")
      .eq("sport", "football")
      .eq("payload_type", "historical_football_odds_attachment")
      .order("observed_at", { ascending: true })
      .order("id", { ascending: true })
      .range(pageFrom, pageFrom + pageSize - 1);
    if (error) return { error: error.message };
    const page = data ?? [];
    rows += page.length;
    for (const row of page) {
      const savedRequest = recordValue(row.request);
      const date = cleanText(savedRequest.date);
      const savedSportKey = cleanText(savedRequest.sportKey) || "soccer_epl";
      const savedFixtureProvider = cleanText(savedRequest.fixtureProvider) || "api_football";
      if (!date || !Number.isFinite(Date.parse(date)) || savedSportKey !== sportKey || savedFixtureProvider !== fixtureProvider) continue;
      keys.add(footballHistoricalOddsCheckpointKey(savedRequest.isClosing === true ? "closing" : "opening", date));
    }
    if (page.length < pageSize) break;
  }
  return { keys: [...keys], rows };
}

export function buildFootballHistoricalOddsBackfillPlan({
  fixtures,
  request,
  completedSnapshots = [],
  checkpointRows = 0
}: {
  fixtures: HistoricalFootballFixtureInput[];
  request: FootballHistoricalOddsBackfillRequest;
  completedSnapshots?: Iterable<string>;
  checkpointRows?: number;
}): FootballHistoricalOddsBackfillPlan {
  const mode = normalizedMode(request.mode);
  const execute = Boolean(request.execute);
  const dryRun = request.dryRun ?? true;
  const maxJobs = boundedInteger(request.maxJobs, DEFAULT_MAX_JOBS, 1, HARD_MAX_JOBS);
  const offset = boundedInteger(request.offset, 0, 0, 100_000);
  const fixtureProvider = cleanText(request.fixtureProvider) || "api_football";
  const warnings: string[] = [];
  const errors: string[] = [];
  const normalizedFixtures = fixtures
    .filter(validFixture)
    .sort((left, right) => Date.parse(left.kickoffAt) - Date.parse(right.kickoffAt));

  if (!normalizedFixtures.length) errors.push("No finished canonical football fixtures were available for historical odds planning.");

  const generatedJobs = [
    ...(mode === "opening" || mode === "both" ? buildOpeningJobs(normalizedFixtures, request) : []),
    ...(mode === "closing" || mode === "both" ? buildClosingJobs(normalizedFixtures, request) : [])
  ].sort((left, right) => Date.parse(left.snapshotAt) - Date.parse(right.snapshotAt) || left.mode.localeCompare(right.mode));
  const coverageStart = Date.parse(THE_ODDS_API_EPL_HISTORICAL_START);
  const eligibleJobs = generatedJobs.filter((job) => Date.parse(job.snapshotAt) >= coverageStart);
  const completedKeys = new Set(completedSnapshots);
  const remainingJobs = eligibleJobs.filter((job) => !completedKeys.has(footballHistoricalOddsCheckpointKey(job.mode, job.snapshotAt)));
  const completedJobs = eligibleJobs.length - remainingJobs.length;
  const skippedBeforeCoverage = generatedJobs.length - eligibleJobs.length;
  const jobs = errors.length ? [] : remainingJobs.slice(offset, offset + maxJobs);
  const nextOffset = offset + jobs.length < remainingJobs.length ? offset + jobs.length : null;
  const truncated = nextOffset !== null;
  const estimatedCreditsPerJob = 10 * quotaUnits(request);

  if (skippedBeforeCoverage) {
    warnings.push(`${skippedBeforeCoverage} job(s) were skipped because EPL historical odds begin at ${THE_ODDS_API_EPL_HISTORICAL_START}.`);
  }
  if (completedJobs) warnings.push(`${completedJobs} completed job(s) were excluded using stored attachment checkpoints.`);
  if (truncated) warnings.push(`Plan is capped at ${maxJobs} job(s); resume with offset=${nextOffset}.`);
  if (!execute) warnings.push("Plan-only mode is active. No The Odds API credits will be spent.");
  if (execute && dryRun) warnings.push("Execution will spend provider credits but will not write odds rows because dryRun=1.");
  if (execute && !dryRun) warnings.push("Execution will spend provider credits and write matched odds rows to Supabase.");
  if (mode === "opening" || mode === "both") {
    warnings.push("Opening jobs are pre-match reference snapshots; they are never labeled as closing lines.");
  }

  return {
    mode,
    execute,
    dryRun,
    fixtureProvider,
    fixtureCount: normalizedFixtures.length,
    totalGeneratedJobs: generatedJobs.length,
    totalCandidateJobs: eligibleJobs.length,
    completedJobs,
    remainingCandidateJobs: remainingJobs.length,
    checkpointRows,
    skippedBeforeCoverage,
    offset,
    maxJobs,
    jobs,
    nextOffset,
    truncated,
    estimatedCreditsPerJob,
    estimatedCredits: jobs.length * estimatedCreditsPerJob,
    totalEstimatedCredits: remainingJobs.length * estimatedCreditsPerJob,
    earliestHistoricalSnapshot: THE_ODDS_API_EPL_HISTORICAL_START,
    warnings,
    errors
  };
}

function statusForExecution({
  plan,
  storedJobs,
  dryRunJobs,
  noMatchJobs,
  failedJobs,
  notConfiguredJobs
}: {
  plan: FootballHistoricalOddsBackfillPlan;
  storedJobs: number;
  dryRunJobs: number;
  noMatchJobs: number;
  failedJobs: number;
  notConfiguredJobs: number;
}): BackfillStatus {
  if (plan.errors.length) return "invalid-request";
  if (!plan.execute || !plan.jobs.length) return "planned";
  if ((storedJobs || dryRunJobs) && (failedJobs || noMatchJobs || notConfiguredJobs)) return "partial";
  if (storedJobs) return "stored";
  if (dryRunJobs) return "dry-run";
  if (noMatchJobs && !failedJobs && !notConfiguredJobs) return "no-matches";
  if (notConfiguredJobs && !failedJobs) return "not-configured";
  return "failed";
}

function emptyPlan(request: FootballHistoricalOddsBackfillRequest, error: string): FootballHistoricalOddsBackfillPlan {
  const plan = buildFootballHistoricalOddsBackfillPlan({ fixtures: [], request });
  return { ...plan, errors: [error] };
}

export async function runFootballHistoricalOddsBackfill({
  request,
  env = process.env,
  fetchImpl = fetch,
  corpusReader = readStoredFootballProviderFixtures,
  attachmentRunner = attachFootballHistoricalOdds,
  completionReader = readStoredFootballOddsBackfillCheckpoints
}: {
  request: FootballHistoricalOddsBackfillRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
  corpusReader?: CorpusReader;
  attachmentRunner?: AttachmentRunner;
  completionReader?: CompletionReader;
}): Promise<FootballHistoricalOddsBackfillResult> {
  const fixtureProvider = cleanText(request.fixtureProvider) || "api_football";
  const corpus = await corpusReader({
    provider: fixtureProvider,
    limit: boundedInteger(request.fixtureLimit, 500, 1, 500),
    batchLimit: boundedInteger(request.batchLimit, 50, 1, 1000),
    season: cleanText(request.season) || undefined,
    leagueExternalId: cleanText(request.leagueExternalId) || undefined
  });
  if ("error" in corpus) {
    const plan = emptyPlan(request, corpus.error);
    return {
      status: corpus.error.toLowerCase().includes("not configured") ? "not-configured" : "failed",
      execute: Boolean(request.execute),
      dryRun: request.dryRun ?? true,
      source: null,
      plan,
      executedJobs: 0,
      storedJobs: 0,
      dryRunJobs: 0,
      noMatchJobs: 0,
      failedJobs: 0,
      fetchedEvents: 0,
      matchedFixtures: 0,
      closingRejectedFixtures: 0,
      oddsRows: 0,
      rowsWritten: 0,
      estimatedCreditsConsumed: 0,
      warnings: plan.warnings,
      errors: [corpus.error],
      jobs: []
    };
  }

  const sportKey = cleanText(request.sportKey) || "soccer_epl";
  const checkpoints = await completionReader({ sportKey, fixtureProvider });
  const checkpointError = "error" in checkpoints ? checkpoints.error : null;
  const checkpointKeys = "error" in checkpoints ? [] : checkpoints.keys;
  const checkpointRows = "error" in checkpoints ? 0 : checkpoints.rows;
  const plan = buildFootballHistoricalOddsBackfillPlan({
    fixtures: corpus.fixtures,
    request,
    completedSnapshots: checkpointKeys,
    checkpointRows
  });
  if (checkpointError) {
    plan.warnings.push(`Stored checkpoint discovery failed: ${checkpointError}`);
    if (plan.execute) plan.errors.push("Execution is blocked because completed attachment checkpoints could not be verified safely.");
  }
  const jobResults: FootballHistoricalOddsBackfillJobResult[] = [];
  const warnings = [...plan.warnings];
  const errors = [...plan.errors];
  let storedJobs = 0;
  let dryRunJobs = 0;
  let noMatchJobs = 0;
  let failedJobs = 0;
  let notConfiguredJobs = 0;
  let fetchedEvents = 0;
  let matchedFixtures = 0;
  let closingRejectedFixtures = 0;
  let oddsRows = 0;
  let rowsWritten = 0;

  if (plan.execute && !plan.errors.length) {
    for (const job of plan.jobs) {
      const result = await attachmentRunner({ request: job.request, env, fetchImpl });
      jobResults.push({ job, result });
      fetchedEvents += result.fetched;
      matchedFixtures += result.matchedFixtures;
      closingRejectedFixtures += result.closingRejectedFixtures;
      oddsRows += result.oddsRows;
      rowsWritten += result.rowsWritten;

      if (result.status === "stored") storedJobs += 1;
      else if (result.status === "dry-run") dryRunJobs += 1;
      else if (result.status === "no-matches") {
        noMatchJobs += 1;
        warnings.push(`${job.id}: ${result.reason ?? "No canonical fixture matches."}`);
      } else {
        failedJobs += 1;
        if (result.status === "not-configured") notConfiguredJobs += 1;
        errors.push(`${job.id}: ${result.reason ?? result.status}`);
        if (request.stopOnError) break;
      }
    }
  }

  const executedJobs = jobResults.length;
  return {
    status: statusForExecution({ plan, storedJobs, dryRunJobs, noMatchJobs, failedJobs, notConfiguredJobs }),
    execute: plan.execute,
    dryRun: plan.dryRun,
    source: corpus.source,
    plan,
    executedJobs,
    storedJobs,
    dryRunJobs,
    noMatchJobs,
    failedJobs,
    fetchedEvents,
    matchedFixtures,
    closingRejectedFixtures,
    oddsRows,
    rowsWritten,
    estimatedCreditsConsumed: executedJobs * plan.estimatedCreditsPerJob,
    warnings,
    errors,
    jobs: jobResults
  };
}
