import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { buildFootballProviderLiveFeatureMaterializer } from "@/lib/sports/training/footballProviderLiveFeatureMaterializer";
import { footballProviderLiveRuntimeRequestFromUrl, getFootballProviderLiveRuntimeSnapshot } from "@/lib/sports/training/footballProviderLiveRuntime";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("football-provider-live-feature-materializer is read-only; use dryRun=1.", 400);

  const runtimeRequest = footballProviderLiveRuntimeRequestFromUrl(url);
  const runtime = await getFootballProviderLiveRuntimeSnapshot(runtimeRequest);
  const receipt = buildFootballProviderLiveFeatureMaterializer({
    provider: runtime.providerLabel,
    matches: runtime.matches,
    targetDate: runtime.targetDate
  });

  return apiSuccess({ ...receipt, liveRuntime: runtime });
}
