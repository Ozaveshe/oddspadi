import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";
import { buildMultiSportBacktestRun, type MultiSportBacktestRun } from "@/lib/sports/training/multiSportBacktestRun";
import { buildMultiSportCorpusPlan, type TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parsePositiveInteger(value: string | null, fallback: number, maximum: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function parseSports(value: string | null): TrainingCorpusSport[] | undefined {
  if (!value || value === "all") return undefined;
  const sports = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!sports.length) return undefined;
  return sports.every((sport): sport is TrainingCorpusSport => sport === "football" || sport === "basketball" || sport === "tennis")
    ? sports
    : [];
}

function statusCodeFor(status: MultiSportBacktestRun["status"]): number {
  if (status === "failed") return 500;
  if (status === "blocked-storage") return 503;
  if (status === "no-data") return 409;
  return 200;
}

type BuildFromRequestResult =
  | { ok: false; error: string }
  | { ok: true; result: MultiSportBacktestRun };

async function buildFromRequest(request: Request, runRequested: boolean, adminAuthorized: boolean): Promise<BuildFromRequestResult> {
  const url = new URL(request.url);
  const sports = parseSports(url.searchParams.get("sport"));
  if (sports?.length === 0) return { ok: false, error: "sport must be football, basketball, tennis, a comma-separated subset, or all." };

  const corpusPlan = buildMultiSportCorpusPlan({
    env: process.env,
    baseUrl: url.origin,
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom"), 2016, 2100),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo"), 2025, 2100),
    maxJobsPerLeague: parsePositiveInteger(url.searchParams.get("maxJobsPerLeague"), 1, 50),
    sports
  });
  const trainingSnapshots = await Promise.all(corpusPlan.sports.map((sportPlan) => getTrainingDataSnapshot(sportPlan.sport)));
  const result = await buildMultiSportBacktestRun({
    corpusPlan,
    trainingSnapshots,
    selectedSports: sports,
    runRequested,
    adminAuthorized,
    minSample: parsePositiveInteger(url.searchParams.get("minSample"), 30, 10_000),
    limit: parsePositiveInteger(url.searchParams.get("limit"), 5_000, 50_000),
    includeDemo: enabled(url.searchParams.get("includeDemo"))
  });
  return { ok: true, result };
}

export const GET = withApiHandler(async (request: Request) => {
  const runRequested = enabled(new URL(request.url).searchParams.get("run"));
  if (runRequested) return apiError("GET is read-only. Use POST with a valid x-oddspadi-admin-token to execute a backtest.", 405);
  const built = await buildFromRequest(request, false, false);
  if (!built.ok) return apiError(built.error, 400);
  return apiSuccess(built.result, { status: statusCodeFor(built.result.status) });
});

export const POST = withApiHandler(async (request: Request) => {
  if (!isTrainingAdminAuthorized(request)) return apiError("Backtest execution requires a valid x-oddspadi-admin-token.", 401);
  const built = await buildFromRequest(request, true, true);
  if (!built.ok) return apiError(built.error, 400);
  return apiSuccess(built.result, { status: statusCodeFor(built.result.status) });
});
