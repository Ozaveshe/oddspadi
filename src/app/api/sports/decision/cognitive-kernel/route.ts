import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionCognitiveKernel } from "@/lib/sports/prediction/decisionCognitiveKernel";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { runDecisionProviderLearningBridge } from "@/lib/sports/prediction/decisionProviderLearningBridgeRunner";
import { readSupabaseTrainingCorpusCensus } from "@/lib/sports/training/supabaseTrainingCorpusCensus";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Cognitive kernel currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const providerRunRequested = enabled(url.searchParams.get("providerRun")) || enabled(url.searchParams.get("runProviderLearning"));
  const corpusRunRequested = enabled(url.searchParams.get("corpusRun")) || enabled(url.searchParams.get("runCorpusMemory"));
  const adminAuthorized = isDecisionAdminAuthorized(request);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });

  if ((!providerRunRequested || query.sport !== "football") && !corpusRunRequested) return apiSuccess(context.cognitiveKernel);

  const [providerLearningBridge, supabaseTrainingCorpusCensus] = await Promise.all([
    providerRunRequested && query.sport === "football"
      ? runDecisionProviderLearningBridge({
          date: query.date,
          env: process.env,
          runRequested: providerRunRequested,
          adminAuthorized,
          origin: url.origin
        })
      : Promise.resolve(null),
    corpusRunRequested
      ? readSupabaseTrainingCorpusCensus({
          env: process.env,
          origin: url.origin
        })
      : Promise.resolve(null)
  ]);
  const observedKernel = buildDecisionCognitiveKernel({
    date: query.date,
    sport: query.sport,
    dataAuthority: context.dataAuthority,
    modelMathProof: context.modelMathProof,
    oddsIntelligenceProof: context.oddsIntelligenceProof,
    beliefLedger: context.beliefLedger,
    evidenceAcquisitionPlanner: context.evidenceAcquisitionPlanner,
    agentThoughtBoard: context.agentThoughtBoard,
    agentOperationQueue: context.agentOperationQueue,
    launchState: context.launchState,
    openAiLiveReviewReceipt: context.openAiLiveReviewReceipt,
    requirementPulse: context.requirementPulse,
    providerLearningBridge,
    supabaseTrainingCorpusCensus
  });

  return apiSuccess(observedKernel, {
    status:
      providerRunRequested && !adminAuthorized
        ? 401
        : providerLearningBridge?.status === "provider-error" || supabaseTrainingCorpusCensus?.status === "failed"
          ? 502
          : 200
  });
}
