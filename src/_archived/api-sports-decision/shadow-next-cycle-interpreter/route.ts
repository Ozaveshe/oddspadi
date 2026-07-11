import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionShadowNextCycleInterpreter } from "@/lib/sports/prediction/decisionShadowNextCycleInterpreter";
import { observeDecisionShadowNextCycleReceipt } from "@/lib/sports/prediction/decisionShadowNextCycleReceipt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision shadow next-cycle interpreter currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const receipt = await observeDecisionShadowNextCycleReceipt({
    planner: context.shadowNextCyclePlanner,
    runRequested: url.searchParams.get("run") === "1",
    origin: url.origin,
    fetchImpl: fetch
  });

  return apiSuccess(
    buildDecisionShadowNextCycleInterpreter({
      planner: context.shadowNextCyclePlanner,
      receipt
    })
  );
}
