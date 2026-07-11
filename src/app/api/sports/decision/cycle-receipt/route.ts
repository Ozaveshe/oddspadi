import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { observeDecisionCycleReceipt } from "@/lib/sports/prediction/decisionCycleReceipt";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision cycle receipt currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const receipt = await observeDecisionCycleReceipt({
    cycleGovernor: context.cycleGovernor,
    runRequested: url.searchParams.get("run") === "1",
    origin: url.origin,
    fetchImpl: fetch
  });

  return apiSuccess(receipt);
}
