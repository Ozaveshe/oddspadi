import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionShadowLoopGovernor } from "@/lib/sports/prediction/decisionShadowLoopGovernor";
import { observeDecisionShadowLoopReceipt } from "@/lib/sports/prediction/decisionShadowLoopReceipt";
import { buildDecisionShadowNextCycleInterpreter } from "@/lib/sports/prediction/decisionShadowNextCycleInterpreter";
import { observeDecisionShadowNextCycleReceipt } from "@/lib/sports/prediction/decisionShadowNextCycleReceipt";
import { buildDecisionShadowReasoningLoop } from "@/lib/sports/prediction/decisionShadowReasoningLoop";
import { buildDecisionShadowWorkingMemory } from "@/lib/sports/prediction/decisionShadowWorkingMemory";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision shadow loop receipt currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const nextCycleReceipt = await observeDecisionShadowNextCycleReceipt({
    planner: context.shadowNextCyclePlanner,
    runRequested: url.searchParams.get("observed") === "1",
    origin: url.origin,
    fetchImpl: fetch
  });
  const interpreter = buildDecisionShadowNextCycleInterpreter({
    planner: context.shadowNextCyclePlanner,
    receipt: nextCycleReceipt
  });
  const memory = buildDecisionShadowWorkingMemory({ interpreter });
  const loop = buildDecisionShadowReasoningLoop({ memory, interpreter });
  const governor = buildDecisionShadowLoopGovernor({ loop, memory, interpreter });
  const receipt = await observeDecisionShadowLoopReceipt({
    governor,
    runRequested: url.searchParams.get("run") === "1",
    origin: url.origin,
    fetchImpl: fetch
  });

  return apiSuccess(receipt);
}
