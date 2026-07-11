import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionMarketPriorLoopReceipt } from "@/lib/sports/prediction/decisionMarketPriorLoopReceipt";
import type { DecisionMarketPriorResolutionTurn } from "@/lib/sports/prediction/decisionMarketPriorResolutionTurn";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  if (query.sport !== "football") return apiError("Market-prior loop receipt currently supports football promotion evidence.");

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("market-prior-loop-receipt is read-only; use dryRun=1.", 400);

  const limit = parseLimit(url.searchParams.get("limit"));
  const run = isEnabled(url.searchParams.get("run"));
  const turn = await fetchDecisionApiData<DecisionMarketPriorResolutionTurn>(
    new URL(`/api/sports/decision/market-prior-resolution-turn?date=${query.date}&sport=${query.sport}&limit=${limit}&dryRun=1${run ? "&run=1" : ""}`, url.origin),
    {
      timeoutMs: run ? 720000 : 560000,
      maxAttempts: 1
    }
  );
  if (!turn) return apiError("Unable to build market-prior resolution turn before loop receipt.", 502);

  return apiSuccess(buildDecisionMarketPriorLoopReceipt({ turn }), { status: turn.status === "proof-failed" ? 502 : 200 });
}
