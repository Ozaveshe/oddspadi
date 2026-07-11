import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import { buildDecisionFinalAnswerTraceReceipt } from "@/lib/sports/prediction/decisionFinalAnswerTraceReceipt";
import { buildDecisionFinalAnswerValidationReceipt } from "@/lib/sports/prediction/decisionFinalAnswerValidationReceipt";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildDecisionMarketCalibratedFusion } from "@/lib/sports/prediction/decisionMarketCalibratedFusion";
import { buildFootballDataHistoricalPromotionProof } from "@/lib/sports/training/footballDataHistoricalPromotionProof";
import { buildFootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";

export const dynamic = "force-dynamic";

function parsePositiveInteger(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function parseNumber(value: string | null): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport,
    baseUrl: url.origin,
    env: process.env
  });

  const benchmarkRequested = isEnabled(url.searchParams.get("benchmark"));
  const historicalRequested = isEnabled(url.searchParams.get("historical")) || isEnabled(url.searchParams.get("publicHistory"));
  if (!benchmarkRequested && !historicalRequested) return apiSuccess(context.finalAnswerTraceReceipt);

  const seasonFrom = parsePositiveInteger(url.searchParams.get("seasonFrom"));
  const seasonTo = parsePositiveInteger(url.searchParams.get("seasonTo"));
  const maxSeasons = parsePositiveInteger(url.searchParams.get("maxSeasons"));
  const trainRatio = parseNumber(url.searchParams.get("trainRatio"));
  const minEdge = parseNumber(url.searchParams.get("minEdge"));
  const minModelProbability = parseNumber(url.searchParams.get("minModelProbability"));
  const minPickCount = parsePositiveInteger(url.searchParams.get("minPickCount"));
  const minTrainingSeasons = parsePositiveInteger(url.searchParams.get("minTrainingSeasons"));
  const limit = parsePositiveInteger(url.searchParams.get("limit"));
  const historicalProof = historicalRequested
    ? await buildFootballDataHistoricalPromotionProof({
        baseUrl: url.origin,
        env: process.env,
        seasonFrom,
        seasonTo,
        maxSeasons,
        trainRatio,
        minEdge,
        minModelProbability,
        minPickCount,
        minTrainingSeasons,
        minSample: parsePositiveInteger(url.searchParams.get("minSample")) ?? 30,
        limit,
        includePublicHistory: true,
        includeBridge: true,
        includeModelPromotion: true
      })
    : null;
  const benchmark =
    historicalProof?.benchmark ??
    (await buildFootballDataMarketBenchmark({
      seasonFrom,
      seasonTo,
      maxSeasons,
      trainRatio,
      minEdge,
      minModelProbability
    }));
  const marketCalibratedFusion = buildDecisionMarketCalibratedFusion({
    date: query.date,
    sport: query.sport,
    probabilityFusionAudit: context.probabilityFusionAudit,
    benchmark
  });
  const answerPromotionGate = buildDecisionAnswerPromotionGate({
    date: query.date,
    sport: query.sport,
    finalAnswer: context.finalAnswerContract,
    finalAnswerCouncil: context.finalAnswerCouncil,
    finalAnswerAIReview: context.finalAnswerAIReview,
    providerEvidenceLedger: context.providerEvidenceLedger,
    modelReasoningLedger: context.modelReasoningLedger,
    marketAuditMatrix: context.marketAuditMatrix,
    marketCalibratedFusion,
    shadowBacktestLedger: context.shadowBacktestLedger,
    trustFirewall: context.trustFirewall,
    abstentionAudit: context.abstentionAudit,
    publicHistoryBacktestBridge: historicalProof?.publicHistoryBacktestBridge ?? null,
    modelPromotionDecision: historicalProof?.modelPromotionDecision ?? null,
    eplFixtureIntake: query.sport === "football" ? context.eplFixtureIntake : null
  });
  const validation = buildDecisionFinalAnswerValidationReceipt({
    date: query.date,
    sport: query.sport,
    finalAnswer: context.finalAnswerContract,
    activationContract: context.engineActivationContract,
    trustFirewall: context.trustFirewall,
    answerPromotionGate
  });
  const trace = buildDecisionFinalAnswerTraceReceipt({
    date: query.date,
    sport: query.sport,
    dataBackbone: context.dataBackbone,
    modelReasoningLedger: context.modelReasoningLedger,
    marketAuditMatrix: context.marketAuditMatrix,
    aiLiveCycleReceipt: context.aiLiveCycleReceipt,
    engineActivationContract: context.engineActivationContract,
    trustFirewall: context.trustFirewall,
    finalAnswer: context.finalAnswerContract,
    answerPromotionGate,
    validation
  });

  return apiSuccess(trace);
}
