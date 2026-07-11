import { apiError, apiSuccess } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildMultiSportLiveSettlementLabelReceipt } from "@/lib/sports/training/multiSportLiveSettlementLabelReceipt";
import type { LiveTrainingSport } from "@/lib/sports/training/multiSportLiveFeatureMaterializer";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

function options(request: Request): { sport: LiveTrainingSport | null; limit: number } {
  const url = new URL(request.url);
  const sportValue = url.searchParams.get("sport") ?? "basketball";
  const sport = sportValue === "basketball" || sportValue === "tennis" ? sportValue : null;
  const parsed = Number(url.searchParams.get("limit"));
  return { sport, limit: Number.isInteger(parsed) ? Math.max(1, Math.min(250, parsed)) : 100 };
}

export async function GET(request: Request) {
  const { sport, limit } = options(request);
  if (!sport) return apiError("sport must be basketball or tennis.", 400);
  try {
    return apiSuccess(await buildMultiSportLiveSettlementLabelReceipt({ sport, limit }));
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Multi-sport settlement preview failed.", 502);
  }
}

export async function POST(request: Request) {
  const { sport, limit } = options(request);
  if (!sport) return apiError("sport must be basketball or tennis.", 400);
  if (!isDecisionAdminAuthorized(request)) return apiError("Settlement label writes require x-oddspadi-admin-token.", 401);
  try {
    const receipt = await buildMultiSportLiveSettlementLabelReceipt({ sport, limit, runRequested: true, adminAuthorized: true });
    return apiSuccess(receipt, { status: receipt.status === "failed" ? 502 : 200 });
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Multi-sport settlement failed.", 502);
  }
}
