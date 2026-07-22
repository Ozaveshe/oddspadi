import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";
import { generateWeeklyPredictions, importFixtures, refreshOdds, runDailyEngine } from "../../src/lib/sports/intelligence/pipeline";
import { readLatestProviderRun } from "../../src/lib/sports/intelligence/repository";
import type { PipelineRunResult } from "../../src/lib/sports/intelligence/types";

declare const Netlify: { env: { get(name: string): string | undefined } };

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

type PipelineOperation = () => Promise<PipelineRunResult>;
type PipelineOperations = {
  importFixtures: PipelineOperation;
  refreshOdds: PipelineOperation;
  runDailyEngine: PipelineOperation;
  generateWeeklyPredictions: PipelineOperation;
};

const defaultOperations: PipelineOperations = {
  importFixtures: () => importFixtures(),
  refreshOdds: () => refreshOdds(),
  runDailyEngine: () => runDailyEngine({ horizonDays: 3 }),
  generateWeeklyPredictions: () => generateWeeklyPredictions()
};

export function dailyCoverageGaps(
  result: PipelineRunResult,
  minimumAnalysedFixturesPerDate = 100,
  expectedDates = 3
): string[] {
  const coverage = result.dateCoverage ?? [];
  const gaps: string[] = [];
  if (coverage.length < expectedDates) {
    gaps.push(`Daily engine returned coverage for ${coverage.length}/${expectedDates} required UTC dates.`);
  }
  for (const day of coverage.slice(0, expectedDates)) {
    if (day.providerBackedFixtures < minimumAnalysedFixturesPerDate) {
      gaps.push(`${day.date}: ${day.providerBackedFixtures}/${minimumAnalysedFixturesPerDate} provider-backed fixtures.`);
    }
    if (day.bookmakerPricedFixtures < minimumAnalysedFixturesPerDate) {
      gaps.push(`${day.date}: ${day.bookmakerPricedFixtures}/${minimumAnalysedFixturesPerDate} fixtures have fresh bookmaker prices.`);
    }
    if (day.analysedFixtures < minimumAnalysedFixturesPerDate) {
      gaps.push(`${day.date}: ${day.analysedFixtures}/${minimumAnalysedFixturesPerDate} bookmaker-backed analyses.`);
    }
  }
  return gaps;
}

async function runStage(
  path: string,
  operation: PipelineOperation,
  minimumAnalysedFixturesPerDate?: number
): Promise<{ path: string; ok: boolean; status: number; body: unknown }> {
  try {
    const result = await operation();
    const coverageGaps = minimumAnalysedFixturesPerDate
      ? dailyCoverageGaps(result, minimumAnalysedFixturesPerDate)
      : [];
    // A light or empty official slate is a valid provider outcome, especially
    // between seasons. Coverage targets are operational warnings, not proof
    // that ingestion or the engine failed. An overlap is also a successful
    // idempotent no-op: the already-running receipt remains authoritative.
    const terminalStatus = ["completed", "partial", "empty"].includes(result.run.status);
    const ok = result.skippedOverlap || terminalStatus;
    const status = result.skippedOverlap ? 202 : ok ? result.run.status === "partial" ? 207 : 200 : 503;
    return {
      path,
      ok,
      status,
      body: {
        success: ok,
        skippedOverlap: result.skippedOverlap,
        coverageTargetMet: coverageGaps.length === 0,
        coverageWarnings: coverageGaps,
        // Retain the old field for operational consumers while they migrate to
        // the more accurate warning terminology.
        coverageGaps,
        data: result
      }
    };
  } catch (error) {
    return { path, ok: false, status: 500, body: { error: error instanceof Error ? error.message : "Pipeline stage failed." } };
  }
}

type LatestRun = { status?: unknown; startedAt?: unknown; finishedAt?: unknown } | null;

export function shouldRunFullCycle({ requested, now, fullRunHour, latestWeeklyRun }: { requested: boolean; now: Date; fullRunHour: number; latestWeeklyRun: LatestRun }): boolean {
  if (requested) return true;
  if (now.getUTCHours() < fullRunHour) return false;
  const timestamp = typeof latestWeeklyRun?.finishedAt === "string"
    ? latestWeeklyRun.finishedAt
    : typeof latestWeeklyRun?.startedAt === "string"
      ? latestWeeklyRun.startedAt
      : null;
  const status = typeof latestWeeklyRun?.status === "string" ? latestWeeklyRun.status : null;
  const sameUtcDay = timestamp?.slice(0, 10) === now.toISOString().slice(0, 10);
  return !(sameUtcDay && ["running", "completed", "partial", "empty"].includes(status ?? ""));
}

export async function runSportsIntelligenceCycle(
  fullCycle: boolean,
  operations: PipelineOperations = defaultOperations,
  minimumAnalysedFixturesPerDate = 100
) {
  const stages = [];
  if (fullCycle) stages.push(await runStage("import-fixtures", operations.importFixtures));
  stages.push(await runStage("refresh-odds", operations.refreshOdds));
  // Rebuild today's canonical decisions after every odds refresh. Import and
  // seven-day generation stay on the bounded daily full cycle, but a new price
  // must not wait until tomorrow before it reaches the public decision board.
  stages.push(await runStage("run-daily-engine", operations.runDailyEngine, minimumAnalysedFixturesPerDate));
  if (fullCycle) {
    stages.push(await runStage("generate-weekly-predictions", operations.generateWeeklyPredictions));
  }
  return stages;
}

export default async function sportsIntelligenceWorker(request: Request, _context: Context): Promise<Response> {
  const token = clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN"));
  const supplied = clean(request.headers.get("x-oddspadi-schedule-token"));
  if (!token) return Response.json({ success: false, error: "Sports intelligence worker configuration is incomplete." }, { status: 503 });
  if (!supplied || !tokenMatches(token, supplied)) return Response.json({ success: false, error: "Sports intelligence worker authorization failed." }, { status: 401 });

  const requestedFullCycle = new URL(request.url).searchParams.get("full") === "1";
  const configuredFullRunHour = Number(Netlify.env.get("ODDSPADI_INTELLIGENCE_FULL_RUN_HOUR_UTC") ?? "2");
  const fullRunHour = Number.isInteger(configuredFullRunHour) && configuredFullRunHour >= 0 && configuredFullRunHour <= 23
    ? configuredFullRunHour
    : 2;
  const now = new Date();
  const configuredMinimum = Number(Netlify.env.get("ODDSPADI_MIN_ANALYSED_FIXTURES_PER_DAY") ?? "100");
  const minimumAnalysedFixturesPerDate = Number.isInteger(configuredMinimum)
    ? Math.max(1, Math.min(1000, configuredMinimum))
    : 100;
  const latestWeeklyRun = requestedFullCycle ? null : await readLatestProviderRun(["generate-weekly-predictions"]);
  const fullCycle = shouldRunFullCycle({ requested: requestedFullCycle, now, fullRunHour, latestWeeklyRun });
  const stages = await runSportsIntelligenceCycle(fullCycle, defaultOperations, minimumAnalysedFixturesPerDate);
  const success = stages.every((stage) => stage.ok);
  const coverageTargetMet = stages.every((stage) => {
    if (!stage.body || typeof stage.body !== "object" || !("coverageTargetMet" in stage.body)) return true;
    return stage.body.coverageTargetMet !== false;
  });
  console.info(JSON.stringify({
    event: "oddspadi-sports-intelligence-cycle",
    success,
    coverageTargetMet,
    fullCycle,
    stages: stages.map(({ path, ok, status }) => ({ path, ok, status }))
  }));
  return Response.json({ success, coverageTargetMet, mode: "sports-intelligence-cycle", fullCycle, stages }, { status: success ? 200 : 502 });
}
