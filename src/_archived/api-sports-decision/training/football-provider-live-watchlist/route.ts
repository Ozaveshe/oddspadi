import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFootballProviderLiveFeatureMaterializer } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import { footballProviderLiveRuntimeRequestFromUrl, getFootballProviderLiveRuntimeSnapshot } from "@/lib/sports/training/footballProviderLiveRuntime";
import { buildFootballProviderLiveWatchlistReceipt } from "@/lib/sports/training/footballProviderLiveWatchlistReceipt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("football-provider-live-watchlist is read-only; use dryRun=1.", 400);

  const runtimeRequest = footballProviderLiveRuntimeRequestFromUrl(url);
  const runtime = await getFootballProviderLiveRuntimeSnapshot(runtimeRequest);
  const materializer = buildFootballProviderLiveFeatureMaterializer({
    provider: runtime.providerLabel,
    matches: runtime.matches,
    targetDate: runtime.targetDate
  });
  const receipt = buildFootballProviderLiveWatchlistReceipt({ materializer });

  return apiSuccess({ ...receipt, liveRuntime: runtime });
}
