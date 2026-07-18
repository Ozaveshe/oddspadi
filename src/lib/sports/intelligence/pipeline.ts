import type { Match, Prediction, Sport } from "@/lib/sports/types";
import { getPredictions, sportsProvider, type PredictionFilters } from "@/lib/sports/service";
import {
  getRecentSportsProviderIssues,
  getSportsProviderRuntimeStatus
} from "@/lib/sports/providers/providerBackedProvider";
import { getSupabaseRuntimeStatus } from "@/lib/supabase/server";
import {
  buildCanonicalDecisions,
  buildCanonicalDecisionForPrediction,
  buildSportsSlate,
  isProviderBackedMatch,
  normalizeCanonicalFixture,
  normalizeOddsSnapshots,
  utcDateWindow
} from "./canonical";
import {
  finishProviderRun,
  persistFixturesAndOdds,
  persistMarketDecisions,
  persistDecisionSummaries,
  readFreshStoredOdds,
  readStoredSlate,
  startProviderRun
} from "./repository";
import type {
  CanonicalDecision,
  CanonicalFixture,
  CanonicalOddsSnapshot,
  PipelineRunResult,
  ProviderRunLog,
  ProviderRunStatus,
  SportsSlate
} from "./types";
import type { DecisionSummary } from "@/lib/sports/types";
import { persistCanonicalPublicPicks } from "@/lib/sports/results/publicPicks";

type PredictionRow = { match: Match; prediction: Prediction };
type SportCoverage = {
  sport: Sport;
  requestedDates: number;
  providerBackedFixtures: number;
  rejectedMockFixtures: number;
};

export type IntelligencePipelineDependencies = {
  getFixtures: (date: string, sport: Sport) => Promise<Match[]>;
  getPredictions: (date: string, sport: Sport) => Promise<PredictionRow[]>;
};

/**
 * Production decision runs must read the promoted learning profile and case
 * memory. `storageMode: "preview"` is reserved for deterministic UI/tests; it
 * deliberately disables those reads in the prediction service.
 */
export function productionPredictionFilters(date: string, sport: Sport): PredictionFilters {
  return { date, sport, providerMode: "live", storageMode: "live" };
}

const defaultDependencies: IntelligencePipelineDependencies = {
  getFixtures: (date, sport) => sportsProvider.getFixtures(date, sport),
  getPredictions: (date, sport) => getPredictions(productionPredictionFilters(date, sport))
};

export function freshestOddsPerSelection(
  current: Map<string, CanonicalOddsSnapshot[]>,
  stored: Map<string, CanonicalOddsSnapshot[]>
): { oddsByFixture: Map<string, CanonicalOddsSnapshot[]>; reusedStoredSnapshots: number; reusedStoredFixtures: number } {
  const result = new Map<string, CanonicalOddsSnapshot[]>();
  let reusedStoredSnapshots = 0;
  let reusedStoredFixtures = 0;
  for (const fixtureId of new Set([...current.keys(), ...stored.keys()])) {
    const latest = new Map<string, { snapshot: CanonicalOddsSnapshot; stored: boolean }>();
    for (const [snapshots, isStored] of [[current.get(fixtureId) ?? [], false], [stored.get(fixtureId) ?? [], true]] as const) {
      for (const snapshot of snapshots) {
        const key = `${snapshot.market}:${snapshot.selection}`;
        const existing = latest.get(key);
        if (!existing || Date.parse(snapshot.capturedAt) > Date.parse(existing.snapshot.capturedAt)) {
          latest.set(key, { snapshot, stored: isStored });
        }
      }
    }
    const selected = [...latest.values()];
    if (selected.some((row) => row.stored)) reusedStoredFixtures += 1;
    reusedStoredSnapshots += selected.filter((row) => row.stored).length;
    result.set(fixtureId, selected.map((row) => row.snapshot));
  }
  return { oddsByFixture: result, reusedStoredSnapshots, reusedStoredFixtures };
}

function configuredSports(env: Record<string, string | undefined>): Sport[] {
  const supported = new Set<Sport>(["football", "basketball", "tennis"]);
  const values = (env.ODDSPADI_PIPELINE_SPORTS?.trim() || "football,basketball,tennis")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value): value is Sport => supported.has(value as Sport));
  return Array.from(new Set(values));
}

function configuredNumber(env: Record<string, string | undefined>, key: string, fallback: number, min: number, max: number): number {
  const parsed = Number(env[key]);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function isoDayStart(date: string): string {
  return `${date}T00:00:00.000Z`;
}

function isoDayAfter(date: string, days = 1): string {
  const parsed = new Date(isoDayStart(date));
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString();
}

function dedupeMatches(matches: Match[]): Match[] {
  return [...new Map(matches.map((match) => [match.id, match])).values()].sort((left, right) => left.kickoffTime.localeCompare(right.kickoffTime));
}

function buildDateCoverage({
  dates,
  fixtures,
  oddsByFixture,
  decisionSummariesByFixture,
  now
}: {
  dates: string[];
  fixtures: CanonicalFixture[];
  oddsByFixture: Map<string, CanonicalOddsSnapshot[]>;
  decisionSummariesByFixture: Map<string, DecisionSummary>;
  now: Date;
}): PipelineRunResult["dateCoverage"] {
  const nowMs = now.getTime();
  return dates.map((date) => {
    const dateFixtures = fixtures.filter((fixture) => fixture.kickoffAt.slice(0, 10) === date);
    const pricedFixtureIds = new Set(
      dateFixtures.flatMap((fixture) => {
        const hasFreshBookmakerPrice = (oddsByFixture.get(fixture.fixtureId) ?? []).some((snapshot) =>
          snapshot.bookmaker.trim().length > 0 &&
          Boolean(snapshot.bookmakerId?.trim()) &&
          Number.isFinite(snapshot.decimalOdds) &&
          snapshot.decimalOdds > 1 &&
          Date.parse(snapshot.expiresAt) > nowMs
        );
        return hasFreshBookmakerPrice ? [fixture.fixtureId] : [];
      })
    );
    const analysedFixtures = dateFixtures.filter((fixture) =>
      pricedFixtureIds.has(fixture.fixtureId) &&
      (decisionSummariesByFixture.get(fixture.fixtureId)?.allMarketAnalyses.length ?? 0) > 0
    ).length;
    return {
      date,
      providerBackedFixtures: dateFixtures.length,
      bookmakerPricedFixtures: pricedFixtureIds.size,
      analysedFixtures
    };
  });
}

/** Preserve degraded provider states instead of collapsing them into success. */
export function classifyProviderRunStatus({
  fixtures,
  errors,
  env
}: {
  fixtures: CanonicalFixture[];
  errors: string[];
  env: Record<string, string | undefined>;
}): ProviderRunStatus {
  const runtime = getSportsProviderRuntimeStatus(env);
  if (!runtime.liveRuntimeBacked) return "unavailable";
  if (!fixtures.length && errors.length) return "failed";
  if (!fixtures.length) return "empty";
  if (errors.length) return "partial";
  return "completed";
}

function emptyRun(jobType: string, startedAt: string): ProviderRunLog {
  return {
    runId: null,
    providerName: "configured-sports-providers",
    jobType,
    startedAt,
    finishedAt: null,
    status: "running",
    fixturesFound: 0,
    oddsFound: 0,
    predictionsGenerated: 0,
    valuePicksPublished: 0,
    errors: []
  };
}

async function collectFixtures({
  dates,
  sports,
  generateDecisions,
  dependencies
}: {
  dates: string[];
  sports: Sport[];
  generateDecisions: boolean;
  dependencies: IntelligencePipelineDependencies;
}): Promise<{
  matches: Match[];
  predictionByFixture: Map<string, Prediction>;
  rejectedMockFixtures: number;
  errors: string[];
  sportCoverage: SportCoverage[];
}> {
  const matches: Match[] = [];
  const predictionByFixture = new Map<string, Prediction>();
  const errors: string[] = [];
  let rejectedMockFixtures = 0;
  const coverage = new Map<Sport, SportCoverage>(
    sports.map((sport) => [sport, { sport, requestedDates: dates.length, providerBackedFixtures: 0, rejectedMockFixtures: 0 }])
  );
  const providerFixtureIds = new Map(sports.map((sport) => [sport, new Set<string>()]));
  const rejectedMockFixtureIds = new Map(sports.map((sport) => [sport, new Set<string>()]));

  for (const date of dates) {
    for (const sport of sports) {
      try {
        if (generateDecisions) {
          const rows = await dependencies.getPredictions(date, sport);
          for (const row of rows) {
            if (!isProviderBackedMatch(row.match)) {
              rejectedMockFixtures += 1;
              rejectedMockFixtureIds.get(sport)?.add(row.match.id);
              continue;
            }
            matches.push(row.match);
            providerFixtureIds.get(sport)?.add(row.match.id);
            predictionByFixture.set(row.match.id, row.prediction);
          }
        } else {
          const rows = await dependencies.getFixtures(date, sport);
          for (const match of rows) {
            if (!isProviderBackedMatch(match)) {
              rejectedMockFixtures += 1;
              rejectedMockFixtureIds.get(sport)?.add(match.id);
              continue;
            }
            matches.push(match);
            providerFixtureIds.get(sport)?.add(match.id);
          }
        }
      } catch (error) {
        errors.push(`${sport} ${date}: ${error instanceof Error ? error.message : "provider request failed"}`);
      }
    }
  }
  const sportCoverage = [...coverage.values()].map((item) => ({
    ...item,
    providerBackedFixtures: providerFixtureIds.get(item.sport)?.size ?? 0,
    rejectedMockFixtures: rejectedMockFixtureIds.get(item.sport)?.size ?? 0
  }));
  for (const item of sportCoverage) {
    if (item.providerBackedFixtures === 0 && item.rejectedMockFixtures > 0) {
      errors.push(
        `${item.sport}: no provider-backed fixtures returned across ${item.requestedDates} requested day(s); rejected ${item.rejectedMockFixtures} fallback mock fixture(s).`
      );
    }
  }
  return { matches: dedupeMatches(matches), predictionByFixture, rejectedMockFixtures, errors, sportCoverage };
}

async function executePipeline({
  jobType,
  dates,
  scope,
  sports,
  generateDecisions,
  preliminary,
  persist,
  now,
  env,
  dependencies
}: {
  jobType: string;
  dates: string[];
  scope: SportsSlate["scope"];
  sports: Sport[];
  generateDecisions: boolean;
  preliminary: boolean;
  persist: boolean;
  now: Date;
  env: Record<string, string | undefined>;
  dependencies: IntelligencePipelineDependencies;
}): Promise<PipelineRunResult> {
  const startedAt = now.toISOString();
  const storageReady = getSupabaseRuntimeStatus(env).serverWriteReady;
  const shouldPersist = persist && storageReady;
  const claim = shouldPersist
    ? await startProviderRun({ providerName: "configured-sports-providers", jobType, startedAt })
    : null;
  let run = claim?.run ?? emptyRun(jobType, startedAt);
  if (shouldPersist && !claim?.acquired) {
    const slate = buildSportsSlate({
      scope,
      fixtures: [],
      oddsByFixture: new Map(),
      decisionsByFixture: new Map(),
      decisionSummariesByFixture: new Map(),
      range: { from: dates[0], to: dates.at(-1) ?? dates[0] },
      providerStatus: run.status,
      providerErrors: run.errors,
      lastRun: run,
      generatedAt: startedAt
    });
    return {
      run,
      slate,
      rejectedMockFixtures: 0,
      dateCoverage: dates.map((date) => ({ date, providerBackedFixtures: 0, bookmakerPricedFixtures: 0, analysedFixtures: 0 })),
      sportCoverage: sports.map((sport) => ({ sport, requestedDates: dates.length, providerBackedFixtures: 0, rejectedMockFixtures: 0 })),
      persisted: false,
      skippedOverlap: true
    };
  }
  const collected = await collectFixtures({ dates, sports, generateDecisions, dependencies });
  const providerIssues = getRecentSportsProviderIssues(startedAt).map((issue) => `${issue.provider}${issue.path}: ${issue.reason}`);
  const errors = [...new Set([...collected.errors, ...providerIssues])];
  const fixtures = collected.matches.map((match) => normalizeCanonicalFixture(match, now));
  let oddsByFixture = new Map<string, CanonicalOddsSnapshot[]>();
  for (const match of collected.matches) {
    oddsByFixture.set(
      match.id,
      normalizeOddsSnapshots(match, now)
    );
  }
  let fixtureIds = new Map<string, string>();
  let storedOddsDiagnostics = { status: "not-read", rowsRead: 0, reusedStoredSnapshots: 0, reusedStoredFixtures: 0, reason: null as string | null };
  if (shouldPersist) {
    try {
      const persisted = await persistFixturesAndOdds({ matches: collected.matches, fixtures, oddsByFixture });
      fixtureIds = persisted.fixtureIds;
      oddsByFixture = persisted.oddsByFixture;
    } catch (error) {
      errors.push(`Storage: ${error instanceof Error ? error.message : "fixture and odds persistence failed"}`);
    }
    const storedOdds = await readFreshStoredOdds({ fixtureExternalIds: fixtures.map((fixture) => fixture.fixtureId), now });
    const merged = freshestOddsPerSelection(oddsByFixture, storedOdds.oddsByFixture);
    oddsByFixture = merged.oddsByFixture;
    storedOddsDiagnostics = {
      status: storedOdds.status,
      rowsRead: storedOdds.rowsRead,
      reusedStoredSnapshots: merged.reusedStoredSnapshots,
      reusedStoredFixtures: merged.reusedStoredFixtures,
      reason: storedOdds.reason
    };
    if (storedOdds.status === "failed" && storedOdds.reason) errors.push(`Storage: ${storedOdds.reason}`);
  }

  const decisionsByFixture = new Map<string, CanonicalDecision[]>();
  const decisionSummariesByFixture = new Map<string, DecisionSummary>();
  if (generateDecisions) {
    for (const match of collected.matches) {
      const prediction = collected.predictionByFixture.get(match.id);
      if (!prediction) continue;
      const snapshots = oddsByFixture.get(match.id) ?? [];
      decisionSummariesByFixture.set(
        match.id,
        buildCanonicalDecisionForPrediction(match, prediction, snapshots, now)
      );
      decisionsByFixture.set(
        match.id,
        buildCanonicalDecisions(match, prediction, snapshots, {
          now,
          preliminary
        })
      );
    }
    if (shouldPersist && fixtureIds.size) {
      try {
        await persistMarketDecisions({
          decisionsByFixture,
          fixtureIds,
          fixtureSports: new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture.sport]))
        });
        await persistDecisionSummaries({
          decisionSummariesByFixture,
          fixtureIds,
          fixtureSports: new Map(fixtures.map((fixture) => [fixture.fixtureId, fixture.sport]))
        });
        if (!preliminary) {
          const publication = await persistCanonicalPublicPicks({
            matches: collected.matches,
            summariesByFixture: decisionSummariesByFixture,
            decisionsByFixture,
            fixtureIds
          });
          errors.push(...publication.errors.map((error) => `Public picks: ${error}`));
        }
      } catch (error) {
        errors.push(`Storage: ${error instanceof Error ? error.message : "decision persistence failed"}`);
      }
    }
  }

  const status = classifyProviderRunStatus({ fixtures, errors, env });
  const providers = Array.from(new Set(fixtures.map((fixture) => fixture.provider))).sort();
  const valuePicksPublished = [...decisionSummariesByFixture.values()].filter((summary) => summary.publicStatus === "value_pick").length;
  const dateCoverage = buildDateCoverage({ dates, fixtures, oddsByFixture, decisionSummariesByFixture, now });
  const predictionsGenerated = dateCoverage.reduce((sum, coverage) => sum + coverage.analysedFixtures, 0);
  const finishedAt = new Date().toISOString();
  run = await finishProviderRun(run, {
    finishedAt,
    status,
    fixturesFound: fixtures.length,
    oddsFound: [...oddsByFixture.values()].reduce((sum, rows) => sum + rows.length, 0),
    predictionsGenerated,
    valuePicksPublished,
    errors
  }, undefined, { sportCoverage: collected.sportCoverage, dateCoverage, storedOdds: storedOddsDiagnostics });
  run = { ...run, providerName: providers.join(", ") || "configured-sports-providers" };
  const slate = buildSportsSlate({
    scope,
    fixtures,
    oddsByFixture,
    decisionsByFixture,
    decisionSummariesByFixture,
    range: { from: dates[0], to: dates.at(-1) ?? dates[0] },
    providerStatus: status,
    providerErrors: errors,
    lastRun: run,
    generatedAt: finishedAt
  });
  return {
    run,
    slate,
    rejectedMockFixtures: collected.rejectedMockFixtures,
    dateCoverage,
    sportCoverage: collected.sportCoverage,
    persisted: shouldPersist && (fixtures.length === 0 || fixtureIds.size === fixtures.length) && !errors.some((error) => error.startsWith("Storage:")),
    skippedOverlap: false
  };
}

export function pipelineSports(env: Record<string, string | undefined> = process.env): Sport[] {
  return configuredSports(env);
}

export async function importFixtures({
  now = new Date(),
  sports,
  persist = true,
  env = process.env,
  dependencies = defaultDependencies
}: {
  now?: Date;
  sports?: Sport[];
  persist?: boolean;
  env?: Record<string, string | undefined>;
  dependencies?: IntelligencePipelineDependencies;
} = {}): Promise<PipelineRunResult> {
  const horizon = Math.floor(configuredNumber(env, "ODDSPADI_PIPELINE_HORIZON_DAYS", 7, 1, 14));
  return executePipeline({
    jobType: "import-fixtures",
    dates: utcDateWindow(now, horizon + 1),
    scope: "weekly",
    sports: sports ?? configuredSports(env),
    generateDecisions: false,
    preliminary: true,
    persist,
    now,
    env,
    dependencies
  });
}

export async function runDailyEngine({
  now = new Date(),
  dayOffset = 0,
  horizonDays = 1,
  sports,
  persist = true,
  env = process.env,
  dependencies = defaultDependencies
}: {
  now?: Date;
  dayOffset?: number;
  horizonDays?: number;
  sports?: Sport[];
  persist?: boolean;
  env?: Record<string, string | undefined>;
  dependencies?: IntelligencePipelineDependencies;
} = {}): Promise<PipelineRunResult> {
  const boundedHorizonDays = Math.floor(Math.max(1, Math.min(7, horizonDays)));
  return executePipeline({
    jobType: "run-daily-engine",
    dates: utcDateWindow(now, boundedHorizonDays, dayOffset),
    scope: "daily",
    sports: sports ?? configuredSports(env),
    generateDecisions: true,
    preliminary: false,
    persist,
    now,
    env,
    dependencies
  });
}

export async function refreshOdds({
  now = new Date(),
  horizonDays = 3,
  sports,
  persist = true,
  env = process.env,
  dependencies = defaultDependencies
}: {
  now?: Date;
  horizonDays?: number;
  sports?: Sport[];
  persist?: boolean;
  env?: Record<string, string | undefined>;
  dependencies?: IntelligencePipelineDependencies;
} = {}): Promise<PipelineRunResult> {
  const boundedHorizonDays = Math.floor(Math.max(1, Math.min(7, horizonDays)));
  return executePipeline({
    jobType: "refresh-odds",
    dates: utcDateWindow(now, boundedHorizonDays),
    scope: "daily",
    sports: sports ?? configuredSports(env),
    generateDecisions: false,
    preliminary: true,
    persist,
    now,
    env,
    dependencies
  });
}

export async function generateWeeklyPredictions({
  now = new Date(),
  sports,
  persist = true,
  env = process.env,
  dependencies = defaultDependencies
}: {
  now?: Date;
  sports?: Sport[];
  persist?: boolean;
  env?: Record<string, string | undefined>;
  dependencies?: IntelligencePipelineDependencies;
} = {}): Promise<PipelineRunResult> {
  return executePipeline({
    jobType: "generate-weekly-predictions",
    dates: utcDateWindow(now, 7),
    scope: "weekly",
    sports: sports ?? configuredSports(env),
    generateDecisions: true,
    preliminary: true,
    persist,
    now,
    env,
    dependencies
  });
}

function buildReadOnlySlate({
  scope,
  dates,
  now,
  reason
}: {
  scope: SportsSlate["scope"];
  dates: string[];
  now: Date;
  reason: string;
}): SportsSlate {
  return buildSportsSlate({
    scope,
    fixtures: [],
    oddsByFixture: new Map(),
    decisionsByFixture: new Map(),
    decisionSummariesByFixture: new Map(),
    range: { from: dates[0], to: dates.at(-1) ?? dates[0] },
    providerStatus: "unavailable",
    providerErrors: [reason],
    generatedAt: now.toISOString()
  });
}

export async function getDailySlate({
  now = new Date(),
  ensure = true,
  dayOffset = 0,
  env = process.env,
  maxFixtureAgeMs: requestedMaxFixtureAgeMs,
  includeSuspended = false
}: { now?: Date; ensure?: boolean; dayOffset?: number; env?: Record<string, string | undefined>; maxFixtureAgeMs?: number; includeSuspended?: boolean } = {}): Promise<SportsSlate> {
  const date = utcDateWindow(now, 1, dayOffset)[0];
  const maxFixtureAgeMs = requestedMaxFixtureAgeMs ?? configuredNumber(env, "ODDSPADI_STORED_FIXTURE_MAX_AGE_MINUTES", 360, 30, 1440) * 60_000;
  try {
    const stored = await readStoredSlate({
      scope: "daily",
      from: isoDayStart(date),
      toExclusive: isoDayAfter(date),
      jobTypes: ["run-daily-engine", "refresh-odds"],
      now,
      maxFixtureAgeMs,
      includeSuspended
    });
    if (stored && (stored.summary.predictionsGenerated > 0 || !ensure)) return stored;
    if (!ensure) return buildReadOnlySlate({
      scope: "daily",
      dates: [date],
      now,
      reason: "No stored daily engine run is available. This public read did not invoke live providers."
    });
  } catch (error) {
    if (!ensure) return buildReadOnlySlate({
      scope: "daily",
      dates: [date],
      now,
      reason: `The stored daily engine run could not be read: ${error instanceof Error ? error.message : "unknown repository error"}`
    });
  }
  return (await runDailyEngine({ now, dayOffset, persist: getSupabaseRuntimeStatus(env).serverWriteReady, env })).slate;
}

export async function getWeeklySlate({
  now = new Date(),
  ensure = true,
  env = process.env
}: { now?: Date; ensure?: boolean; env?: Record<string, string | undefined> } = {}): Promise<SportsSlate> {
  const dates = utcDateWindow(now, 7);
  const maxFixtureAgeMs = configuredNumber(env, "ODDSPADI_STORED_FIXTURE_MAX_AGE_MINUTES", 360, 30, 1440) * 60_000;
  try {
    const stored = await readStoredSlate({
      scope: "weekly",
      from: isoDayStart(dates[0]),
      toExclusive: isoDayAfter(dates.at(-1) ?? dates[0]),
      jobTypes: ["generate-weekly-predictions", "refresh-odds", "run-daily-engine"],
      now,
      maxFixtureAgeMs
    });
    if (stored && (stored.summary.predictionsGenerated > 0 || !ensure)) return stored;
    if (!ensure) return buildReadOnlySlate({
      scope: "weekly",
      dates,
      now,
      reason: "No stored weekly engine run is available. This public read did not invoke live providers."
    });
  } catch (error) {
    if (!ensure) return buildReadOnlySlate({
      scope: "weekly",
      dates,
      now,
      reason: `The stored weekly engine run could not be read: ${error instanceof Error ? error.message : "unknown repository error"}`
    });
  }
  return (await generateWeeklyPredictions({ now, persist: getSupabaseRuntimeStatus(env).serverWriteReady, env })).slate;
}
