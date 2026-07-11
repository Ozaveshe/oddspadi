import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { observeDecisionShadowLoopContinuityReceipt } from "@/lib/sports/prediction/decisionShadowLoopContinuityReceipt";
import { buildDecisionShadowLoopContinuityReceiptInterpreter } from "@/lib/sports/prediction/decisionShadowLoopContinuityReceiptInterpreter";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision shadow loop continuity receipt interpreter currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const receipt = await observeDecisionShadowLoopContinuityReceipt({
    continuity: context.shadowLoopContinuity,
    runRequested: url.searchParams.get("run") === "1",
    origin: url.origin,
    fetchImpl: fetch
  });

  return apiSuccess(
    buildDecisionShadowLoopContinuityReceiptInterpreter({
      continuity: context.shadowLoopContinuity,
      receipt
    })
  );
}
