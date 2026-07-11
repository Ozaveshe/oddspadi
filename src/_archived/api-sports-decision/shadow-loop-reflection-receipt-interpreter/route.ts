import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionShadowLoopReflectionReceiptInterpreter } from "@/lib/sports/prediction/decisionShadowLoopReflectionReceiptInterpreter";
import { observeDecisionShadowLoopReflectionReceipt } from "@/lib/sports/prediction/decisionShadowLoopReflectionReceipt";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision shadow loop reflection receipt interpreter currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const receipt = await observeDecisionShadowLoopReflectionReceipt({
    reflection: context.shadowLoopReflection,
    runRequested: url.searchParams.get("run") === "1",
    origin: url.origin,
    fetchImpl: fetch
  });

  return apiSuccess(
    buildDecisionShadowLoopReflectionReceiptInterpreter({
      reflection: context.shadowLoopReflection,
      receipt
    })
  );
}
