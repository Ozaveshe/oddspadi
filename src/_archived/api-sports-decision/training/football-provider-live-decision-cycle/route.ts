import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildFootballProviderLiveActivationReceipt } from "@/lib/sports/training/footballProviderLiveActivationReceipt";
import { buildFootballProviderLiveBriefingPacket } from "@/lib/sports/training/footballProviderLiveBriefingPacket";
import { buildFootballProviderLiveDecisionCycleReceipt } from "@/lib/sports/training/footballProviderLiveDecisionCycleReceipt";
import { buildFootballProviderLiveFeatureMaterializer } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import { observeFootballProviderLiveFeatureStorageReceipt } from "@/lib/sports/training/footballProviderLiveFeatureStorageReceipt";
import { runFootballProviderLiveAIReviewReceipt } from "@/lib/sports/training/footballProviderLiveAIReviewReceipt";
import { footballProviderLiveRuntimeRequestFromUrl, getFootballProviderLiveRuntimeSnapshot } from "@/lib/sports/training/footballProviderLiveRuntime";
import { buildFootballProviderLiveWatchlistReceipt } from "@/lib/sports/training/footballProviderLiveWatchlistReceipt";

export const dynamic = "force-dynamic";

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runAiRequested = isEnabled(url.searchParams.get("runAi"));
  if (runAiRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("Live provider OpenAI review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const runtimeRequest = footballProviderLiveRuntimeRequestFromUrl(url);
  const runtime = await getFootballProviderLiveRuntimeSnapshot(runtimeRequest);
  const materializer = buildFootballProviderLiveFeatureMaterializer({
    provider: runtime.providerLabel,
    matches: runtime.matches,
    targetDate: runtime.targetDate
  });
  const storage = await observeFootballProviderLiveFeatureStorageReceipt({
    materializer,
    runRequested: false,
    adminAuthorized: false,
    filters: runtime.filters,
    env: process.env,
    origin: url.origin
  });
  const watchlist = buildFootballProviderLiveWatchlistReceipt({ materializer });
  const briefing = buildFootballProviderLiveBriefingPacket({ watchlist });
  const activation = buildFootballProviderLiveActivationReceipt({
    runtime,
    materializer,
    storage,
    watchlist,
    briefing
  });
  const aiReview = await runFootballProviderLiveAIReviewReceipt({
    activation,
    briefing,
    runRequested: runAiRequested,
    env: process.env
  });
  const receipt = buildFootballProviderLiveDecisionCycleReceipt({
    activation,
    briefing,
    aiReview
  });

  return apiSuccess(receipt);
}
