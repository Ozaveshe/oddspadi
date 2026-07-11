import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { observeDecisionCycleReceipt } from "@/lib/sports/prediction/decisionCycleReceipt";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionSupervisedAgentRunner } from "@/lib/sports/prediction/decisionSupervisedAgentRunner";
import { buildDecisionSupervisedAgentRun } from "@/lib/sports/prediction/decisionSupervisedAgentRun";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision supervised agent runner currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const runRequested = url.searchParams.get("run") === "1";
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const observedReceipt = await observeDecisionCycleReceipt({
    cycleGovernor: context.cycleGovernor,
    runRequested,
    origin: url.origin,
    fetchImpl: fetch
  });
  const observedRun = buildDecisionSupervisedAgentRun({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    brainState: context.brainState,
    cognitiveKernel: context.cognitiveKernel,
    brainReviewRunner: context.brainReviewRunner,
    cycleGovernor: context.cycleGovernor,
    cycleReceipt: observedReceipt,
    outcomeReplay: context.outcomeReplay,
    learningPromotionGate: context.learningPromotionGate,
    learningConsolidator: context.learningConsolidator
  });

  return apiSuccess(
    buildDecisionSupervisedAgentRunner({
      date: query.date,
      sport: query.sport as DecisionMultiSport,
      runRequested,
      previewRun: context.supervisedAgentRun,
      observedRun,
      observedReceipt
    })
  );
}
