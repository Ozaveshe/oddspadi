import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildMultiSportCorpusPlan, type TrainingCorpusSport } from "@/lib/sports/training/multiSportCorpusPlan";
import { buildProviderCorpusDryRunQueue } from "@/lib/sports/training/providerCorpusDryRunQueue";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const sports = parseSports(url.searchParams.get("sport"));
  if (sports?.length === 0) return apiError("sport must be football, basketball, tennis, a comma-separated subset, or all.");

  const runRequested = enabled(url.searchParams.get("run"));
  const adminAuthorized = isDecisionAdminAuthorized(request);
  const corpusPlan = buildMultiSportCorpusPlan({
    env: process.env,
    baseUrl: url.origin,
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")) ?? parsePositiveInteger(url.searchParams.get("season")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")) ?? parsePositiveInteger(url.searchParams.get("season")),
    maxJobsPerLeague: parsePositiveInteger(url.searchParams.get("maxJobsPerLeague")),
    sports
  });
  const queue = await buildProviderCorpusDryRunQueue({
    corpusPlan,
    env: process.env,
    runRequested,
    adminAuthorized,
    selectedJobId: url.searchParams.get("jobId"),
    origin: url.origin
  });

  return apiSuccess(queue, { status: runRequested && !adminAuthorized ? 401 : queue.status === "provider-error" ? 502 : 200 });
}
