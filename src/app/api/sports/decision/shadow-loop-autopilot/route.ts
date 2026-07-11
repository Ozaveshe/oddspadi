import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionShadowLoopAutopilot } from "@/lib/sports/prediction/decisionShadowLoopAutopilot";
import { observeDecisionShadowLoopContinuityReceipt } from "@/lib/sports/prediction/decisionShadowLoopContinuityReceipt";
import { buildDecisionShadowLoopContinuityReceiptInterpreter } from "@/lib/sports/prediction/decisionShadowLoopContinuityReceiptInterpreter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision shadow loop autopilot currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });

  if (url.searchParams.get("run") !== "1") {
    return apiSuccess(context.shadowLoopAutopilot);
  }

  const receipt = await observeDecisionShadowLoopContinuityReceipt({
    continuity: context.shadowLoopContinuity,
    runRequested: true,
    origin: url.origin,
    fetchImpl: fetch
  });
  const interpreter = buildDecisionShadowLoopContinuityReceiptInterpreter({
    continuity: context.shadowLoopContinuity,
    receipt
  });

  return apiSuccess(buildDecisionShadowLoopAutopilot({ interpreter }));
}
