import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import type { DecisionOperatorReceipt } from "@/lib/sports/prediction/decisionOperatorReceipt";
import { buildDecisionOperatorState } from "@/lib/sports/prediction/decisionOperatorState";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
  const receiptUrl = new URL("/api/sports/decision/operator-receipt", url.origin);
  receiptUrl.searchParams.set("date", query.date);
  receiptUrl.searchParams.set("sport", query.sport);
  if (runRequested) receiptUrl.searchParams.set("run", "1");

  const receipt = await fetchDecisionApiData<DecisionOperatorReceipt>(receiptUrl, { timeoutMs: 60000, maxAttempts: 2 });
  if (!receipt) {
    return apiError("Unable to build operator receipt before state transition.", 502);
  }

  return apiSuccess(buildDecisionOperatorState({ receipt }));
}
