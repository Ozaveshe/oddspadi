import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import type { DecisionOperatorReceipt } from "@/lib/sports/prediction/decisionOperatorReceipt";
import { buildDecisionOperatorEpisode } from "@/lib/sports/prediction/decisionOperatorEpisode";
import type { DecisionOperatorState } from "@/lib/sports/prediction/decisionOperatorState";
import type { DecisionOperatorTurn } from "@/lib/sports/prediction/decisionOperatorTurn";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
  const turnUrl = new URL("/api/sports/decision/operator-turn", url.origin);
  const receiptUrl = new URL("/api/sports/decision/operator-receipt", url.origin);
  const stateUrl = new URL("/api/sports/decision/operator-state", url.origin);

  for (const target of [turnUrl, receiptUrl, stateUrl]) {
    target.searchParams.set("date", query.date);
    target.searchParams.set("sport", query.sport);
  }
  if (runRequested) {
    receiptUrl.searchParams.set("run", "1");
    stateUrl.searchParams.set("run", "1");
  }

  const [turn, receipt, state] = await Promise.all([
    fetchDecisionApiData<DecisionOperatorTurn>(turnUrl, { timeoutMs: 45000, maxAttempts: 2 }),
    fetchDecisionApiData<DecisionOperatorReceipt>(receiptUrl, { timeoutMs: 60000, maxAttempts: 2 }),
    fetchDecisionApiData<DecisionOperatorState>(stateUrl, { timeoutMs: 75000, maxAttempts: 2 })
  ]);

  if (!turn || !receipt || !state) {
    return apiError("Unable to build the complete operator episode.", 502);
  }

  return apiSuccess(buildDecisionOperatorEpisode({ turn, receipt, state }));
}
