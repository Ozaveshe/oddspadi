import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionShadowLoopInterpreter } from "@/lib/sports/prediction/decisionShadowLoopInterpreter";
import { buildDecisionShadowLoopReflection } from "@/lib/sports/prediction/decisionShadowLoopReflection";
import { observeDecisionShadowLoopReflectionReceipt } from "@/lib/sports/prediction/decisionShadowLoopReflectionReceipt";
import { observeDecisionShadowLoopReceipt } from "@/lib/sports/prediction/decisionShadowLoopReceipt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision shadow loop reflection receipt currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const loopReceipt = await observeDecisionShadowLoopReceipt({
    governor: context.shadowLoopGovernor,
    runRequested: url.searchParams.get("observed") === "1",
    origin: url.origin,
    fetchImpl: fetch
  });
  const interpreter = buildDecisionShadowLoopInterpreter({
    governor: context.shadowLoopGovernor,
    receipt: loopReceipt
  });
  const reflection = buildDecisionShadowLoopReflection({ interpreter });
  const receipt = await observeDecisionShadowLoopReflectionReceipt({
    reflection,
    runRequested: url.searchParams.get("run") === "1",
    origin: url.origin,
    fetchImpl: fetch
  });

  return apiSuccess(receipt);
}
