import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFootballProviderLiveActivationReceipt } from "@/lib/sports/training/footballProviderLiveActivationReceipt";
import { buildFootballProviderLiveBriefingPacket } from "@/lib/sports/training/footballProviderLiveBriefingPacket";
import { buildFootballProviderLiveFeatureMaterializer } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import { observeFootballProviderLiveFeatureStorageReceipt } from "@/lib/sports/training/footballProviderLiveFeatureStorageReceipt";
import { footballProviderLiveRuntimeRequestFromUrl, getFootballProviderLiveRuntimeSnapshot } from "@/lib/sports/training/footballProviderLiveRuntime";
import { buildFootballProviderLiveWatchlistReceipt } from "@/lib/sports/training/footballProviderLiveWatchlistReceipt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") {
    return apiError("football-provider-live-activation is read-only; use dryRun=1.", 400);
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
  const receipt = buildFootballProviderLiveActivationReceipt({
    runtime,
    materializer,
    storage,
    watchlist,
    briefing
  });

  return apiSuccess(receipt);
}
