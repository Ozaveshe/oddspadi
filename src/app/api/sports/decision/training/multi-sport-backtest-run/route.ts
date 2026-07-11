import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildMultiSportBacktestRun, type MultiSportBacktestRun } from "@/lib/sports/training/multiSportBacktestRun";
import { buildMultiSportCorpusPlan, type TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parsePositiveInteger(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, max) : fallback;
}

function parseSports(value: string | null): TrainingCorpusSport[] | undefined {
  if (!value || value === "all") return undefined;
  const sports = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!sports.length) return undefined;
  if (sports.every((sport): sport is TrainingCorpusSport => sport === "football" || sport === "basketball" || sport === "tennis")) return sports;
  return [];
}

type BuildFromRequestResult =
  | { error: string }
  | { result: MultiSportBacktestRun; runRequested: boolean; adminAuthorized: boolean };

function statusCodeFor(status: MultiSportBacktestRun["status"], runRequested: boolean, adminAuthorized: boolean): number {
  if (!runRequested) return 200;
  if (runRequested && !adminAuthorized) return 401;
  if (status === "failed") return 500;
  if (status === "blocked-storage") return 503;
  if (status === "no-data") return 409;
  return 200;
}

async function buildFromRequest(request: Request, runRequested: boolean): Promise<BuildFromRequestResult> {
  const url = new URL(request.url);
  const sports = parseSports(url.searchParams.get("sport"));
  if (sports?.length === 0) return { error: "sport must be football, basketball, tennis, a comma-separated subset, or all." };

  const corpusPlan = buildMultiSportCorpusPlan({
    env: process.env,
    baseUrl: url.origin,
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom"), 2016, 2100),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo"), 2025, 2100),
    maxJobsPerLeague: parsePositiveInteger(url.searchParams.get("maxJobsPerLeague"), 1, 50),
    sports
  });
  const trainingSnapshots = await Promise.all(corpusPlan.sports.map((sportPlan) => getTrainingDataSnapshot(sportPlan.sport)));
  const adminAuthorized = isDecisionAdminAuthorized(request);
  const result = await buildMultiSportBacktestRun({
    corpusPlan,
    trainingSnapshots,
    selectedSports: sports,
    runRequested,
    adminAuthorized,
    minSample: parsePositiveInteger(url.searchParams.get("minSample"), 30, 10000),
    limit: parsePositiveInteger(url.searchParams.get("limit"), 5000, 50000),
    includeDemo: enabled(url.searchParams.get("includeDemo"))
  });

  return { result, runRequested, adminAuthorized };
}

export async function GET(request: Request) {
  const built = await buildFromRequest(request, enabled(new URL(request.url).searchParams.get("run")));
  if ("error" in built) return apiError(built.error, 400);
  return apiSuccess(built.result, { status: statusCodeFor(built.result.status, built.runRequested, built.adminAuthorized) });
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Multi-sport backtest execution requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const built = await buildFromRequest(request, true);
  if ("error" in built) return apiError(built.error, 400);
  return apiSuccess(built.result, { status: statusCodeFor(built.result.status, true, true) });
}
