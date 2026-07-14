import type { Match, Prediction, Sport } from "@/lib/sports/types";
import { getPredictions, sportsProvider } from "@/lib/sports/service";
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

export type IntelligencePipelineDependencies = {
  getFixtures: (date: string, sport: Sport) => Promise<Match[]>;
  getPredictions: (date: string, sport: Sport) => Promise<PredictionRow[]>;
};

const defaultDependencies: IntelligencePipelineDependencies = {
  getFixtures: (date, sport) => sportsProvider.getFixtures(date, sport),
  getPredictions: (date, sport) => getPredictions({ date, sport, providerMode: "live", storageMode: "preview" })
};

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
}): Promise<{ matches: Match[]; predictionByFixture: Map<string, Prediction>; rejectedMockFixtures: number; errors: string[] }> {
  const matches: Match[] = [];
  const predictionByFixture = new Map<string, Prediction>();
  const errors: string[] = [];
  let rejectedMockFixtures = 0;

  for (const date of dates) {
    for (const sport of sports) {
      try {
        if (generateDecisions) {
          const rows = await dependencies.getPredictions(date, sport);
          for (const row of rows) {
            if (!isProviderBackedMatch(row.match)) {
              rejectedMockFixtures += 1;
              continue;
            }
            matches.push(row.match);
            predictionByFixture.set(row.match.id, row.prediction);
          }
        } else {
          const rows = await dependencies.getFixtures(date, sport);
          for (const match of rows) {
            if (!isProviderBackedMatch(match)) {
              rejectedMockFixtures += 1;
              continue;
            }
            matches.push(match);
          }
        }
      } catch (error) {
        errors.push(`${sport} ${date}: ${error instanceof Error ? error.message : "provider request failed"}`);
      }
    }
  }
  return { matches: dedupeMatches(matches), predictionByFixture, rejectedMockFixtures, errors };
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
  let run = shouldPersist
    ? await startProviderRun({ providerName: "configured-sports-providers", jobType, startedAt })
    : emptyRun(jobType, startedAt);
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
  if (shouldPersist) {
    try {
      const persisted = await persistFixturesAndOdds({ matches: collected.matches, fixtures, oddsByFixture });
      fixtureIds = persisted.fixtureIds;
      oddsByFixture = persisted.oddsByFixture;
    } catch (error) {
      errors.push(`Storage: ${error instanceof Error ? error.message : "fixture and odds persistence failed"}`);
    }
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
  const finishedAt = new Date().toISOString();
  run = await finishProviderRun(run, {
    finishedAt,
    status,
    fixturesFound: fixtures.length,
    oddsFound: [...oddsByFixture.values()].reduce((sum, rows) => sum + rows.length, 0),
    predictionsGenerated: decisionsByFixture.size,
    valuePicksPublished,
    errors
  });
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
    persisted: shouldPersist && (fixtures.length === 0 || fixtureIds.size === fixtures.length) && !errors.some((error) => error.startsWith("Storage:"))
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
  sports,
  persist = true,
  env = process.env,
  dependencies = defaultDependencies
}: {
  now?: Date;
  dayOffset?: number;
  sports?: Sport[];
  persist?: boolean;
  env?: Record<string, string | undefined>;
  dependencies?: IntelligencePipelineDependencies;
} = {}): Promise<PipelineRunResult> {
  return executePipeline({
    jobType: "run-daily-engine",
    dates: utcDateWindow(now, 1, dayOffset),
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
    jobType: "refresh-odds",
    dates: utcDateWindow(now, 2),
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

export async function getDailySlate({ now = new Date(), ensure = true, dayOffset = 0 }: { now?: Date; ensure?: boolean; dayOffset?: number } = {}): Promise<SportsSlate> {
  const date = utcDateWindow(now, 1, dayOffset)[0];
  try {
    const stored = await readStoredSlate({
      scope: "daily",
      from: isoDayStart(date),
      toExclusive: isoDayAfter(date),
      jobTypes: ["run-daily-engine", "refresh-odds"]
    });
    if (stored && (stored.summary.predictionsGenerated > 0 || !ensure)) return stored;
  } catch (error) {
    if (!ensure) throw error;
  }
  return (await runDailyEngine({ now, dayOffset, persist: getSupabaseRuntimeStatus().serverWriteReady })).slate;
}

export async function getWeeklySlate({ now = new Date(), ensure = true }: { now?: Date; ensure?: boolean } = {}): Promise<SportsSlate> {
  const dates = utcDateWindow(now, 7);
  try {
    const stored = await readStoredSlate({
      scope: "weekly",
      from: isoDayStart(dates[0]),
      toExclusive: isoDayAfter(dates.at(-1) ?? dates[0]),
      jobTypes: ["generate-weekly-predictions", "refresh-odds", "run-daily-engine"]
    });
    if (stored && (stored.summary.predictionsGenerated > 0 || !ensure)) return stored;
  } catch (error) {
    if (!ensure) throw error;
  }
  return (await generateWeeklyPredictions({ now, persist: getSupabaseRuntimeStatus().serverWriteReady })).slate;
}
