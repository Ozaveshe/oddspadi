import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { materializeFootballProviderCorpus } from "@/lib/sports/training/footballProviderFeatureCorpusRequest";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("football-provider-feature-materializer is read-only; use dryRun=1.", 400);

  const receipt = await materializeFootballProviderCorpus({ url });
  if ("error" in receipt) return apiError(receipt.error, 500);

  return apiSuccess(receipt);
}
