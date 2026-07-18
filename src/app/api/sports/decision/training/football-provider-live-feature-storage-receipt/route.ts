import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFootballProviderLiveFeatureMaterializer } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import { observeFootballProviderLiveFeatureStorageReceipt } from "@/lib/sports/training/footballProviderLiveFeatureStorageReceipt";
import {
  footballProviderLiveRuntimeRequestFromUrl,
  getFootballProviderLiveRuntimeSnapshot
} from "@/lib/sports/training/footballProviderLiveRuntime";
import { isTrainingAdminAuthorized } from "@/lib/sports/training/adminAuth";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function isWriteMode(value: string | null): boolean {
  return value === "0" || value?.toLowerCase() === "false" || value?.toLowerCase() === "no";
}

function boundedInteger(value: string | null, fallback: number, minimum: number, maximum: number): number {
  if (value === null) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function rankedMatches(matches: Awaited<ReturnType<typeof getFootballProviderLiveRuntimeSnapshot>>["matches"], limit: number) {
  return matches
    .slice()
    .sort((left, right) => {
      const providerDifference = Number(right.dataSource?.kind === "provider") - Number(left.dataSource?.kind === "provider");
      if (providerDifference) return providerDifference;
      if (right.dataQualityScore !== left.dataQualityScore) return right.dataQualityScore - left.dataQualityScore;
      return new Date(left.kickoffTime).getTime() - new Date(right.kickoffTime).getTime();
    })
    .slice(0, limit);
}

async function buildReceipt(request: Request, runRequested: boolean, adminAuthorized: boolean) {
  const url = new URL(request.url);
  const runtimeRequest = footballProviderLiveRuntimeRequestFromUrl(url);
  const runtime = await getFootballProviderLiveRuntimeSnapshot(runtimeRequest);
  const limit = boundedInteger(url.searchParams.get("limit"), 20, 1, 100);
  const materializer = buildFootballProviderLiveFeatureMaterializer({
    provider: runtime.providerLabel,
    matches: rankedMatches(runtime.matches, limit),
    targetDate: runtime.targetDate
  });
  const receipt = await observeFootballProviderLiveFeatureStorageReceipt({
    materializer,
    runRequested,
    adminAuthorized,
    filters: runtime.filters,
    env: process.env,
    origin: url.origin
  });

  return apiSuccess({ ...receipt, liveRuntime: runtime }, { status: receipt.status === "failed" ? 500 : 200 });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (isEnabled(url.searchParams.get("run")) || isWriteMode(url.searchParams.get("dryRun"))) {
    return apiError("Live feature writes require POST with dryRun=0, run=1, and x-oddspadi-admin-token. GET is read-only preview.", 405);
  }
  return buildReceipt(request, false, false);
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const runRequested = isEnabled(url.searchParams.get("run"));
  const writeMode = isWriteMode(url.searchParams.get("dryRun"));
  if (!runRequested || !writeMode) {
    return apiError("Live feature writes require POST with dryRun=0 and run=1.", 400);
  }
  if (!isTrainingAdminAuthorized(request)) {
    return apiError("Live feature writes require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  return buildReceipt(request, true, true);
}
