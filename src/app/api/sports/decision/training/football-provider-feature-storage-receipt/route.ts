import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { observeFootballProviderFeatureStorageReceipt } from "@/lib/sports/training/footballDataProviderFeatureStorageReceipt";
import { materializeFootballProviderCorpus } from "@/lib/sports/training/footballProviderFeatureCorpusRequest";

export const dynamic = "force-dynamic";

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runRequested = isEnabled(url.searchParams.get("run"));
  const adminAuthorized = isDecisionAdminAuthorized(request);
  if (runRequested && !adminAuthorized) {
    return apiError("Provider feature storage execution requires run=1 plus x-oddspadi-admin-token.", 401);
  }
  const materializer = await materializeFootballProviderCorpus({ url });
  if ("error" in materializer) return apiError(materializer.error, 500);
  const receipt = await observeFootballProviderFeatureStorageReceipt({
    materializer,
    runRequested,
    adminAuthorized,
    env: process.env,
    origin: url.origin
  });

  return apiSuccess(receipt, { status: receipt.status === "failed" ? 500 : 200 });
}
