import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import { buildDecisionFinalAnswerTraceReceipt } from "@/lib/sports/prediction/decisionFinalAnswerTraceReceipt";
import { buildDecisionFinalAnswerValidationReceipt } from "@/lib/sports/prediction/decisionFinalAnswerValidationReceipt";
import { buildDecisionHistoricalDisciplineReceipt } from "@/lib/sports/prediction/decisionHistoricalDisciplineReceipt";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildDecisionMarketCalibratedFusion } from "@/lib/sports/prediction/decisionMarketCalibratedFusion";
import { buildDecisionMarketPriorGovernor } from "@/lib/sports/prediction/decisionMarketPriorGovernor";
import { buildDecisionMvpProgressReceipt } from "@/lib/sports/prediction/decisionMvpProgressReceipt";
import { buildDecisionTrustAwareAIPacket } from "@/lib/sports/prediction/decisionTrustAwareAIPacket";
import { buildFootballDataHistoricalPromotionProof } from "@/lib/sports/training/footballDataHistoricalPromotionProof";
import { buildFootballDataMarketBenchmark, type FootballDataMarketBenchmark } from "@/lib/sports/training/footballDataMarketBenchmark";

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
  const publicHistoryRequested = isEnabled(url.searchParams.get("publicHistory")) || isEnabled(url.searchParams.get("historical"));
  if (!benchmarkRequested && !publicHistoryRequested) return apiSuccess(context.mvpProgressReceipt);

  const seasonFrom = parsePositiveInteger(url.searchParams.get("seasonFrom"));
  const seasonTo = parsePositiveInteger(url.searchParams.get("seasonTo"));
  const maxSeasons = parsePositiveInteger(url.searchParams.get("maxSeasons"));
  const trainRatio = parseNumber(url.searchParams.get("trainRatio"));
  const minEdge = parseNumber(url.searchParams.get("minEdge"));
  const minModelProbability = parseNumber(url.searchParams.get("minModelProbability"));
  const minPickCount = parsePositiveInteger(url.searchParams.get("minPickCount"));
  const minTrainingSeasons = parsePositiveInteger(url.searchParams.get("minTrainingSeasons"));
  const limit = parsePositiveInteger(url.searchParams.get("limit"));

  const historicalProof = publicHistoryRequested
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
  const historicalLearningDossier = historicalProof?.historicalLearningDossier ?? null;
  const publicHistoricalTrainingEvidence = historicalProof?.publicHistoricalTrainingEvidence ?? null;
  const publicHistoryBacktestBridge = historicalProof?.publicHistoryBacktestBridge ?? null;
  const modelPromotionDecision = historicalProof?.modelPromotionDecision ?? null;
  const benchmark: FootballDataMarketBenchmark | null =
    historicalProof?.benchmark ??
    (benchmarkRequested
      ? await buildFootballDataMarketBenchmark({
          seasonFrom,
          seasonTo,
          maxSeasons,
          trainRatio,
          minEdge,
          minModelProbability
        })
      : null);
  const marketCalibratedFusion = benchmark
    ? buildDecisionMarketCalibratedFusion({
        date: query.date,
        sport: query.sport,
        probabilityFusionAudit: context.probabilityFusionAudit,
        benchmark
      })
    : context.marketCalibratedFusion;
  const answerPromotionGate = benchmark
    ? buildDecisionAnswerPromotionGate({
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
        publicHistoryBacktestBridge,
        modelPromotionDecision,
        eplFixtureIntake: query.sport === "football" ? context.eplFixtureIntake : null
      })
    : context.answerPromotionGate;
  const finalAnswerValidationReceipt = buildDecisionFinalAnswerValidationReceipt({
    date: query.date,
    sport: query.sport,
    finalAnswer: context.finalAnswerContract,
    activationContract: context.engineActivationContract,
    trustFirewall: context.trustFirewall,
    answerPromotionGate
  });
  const finalAnswerTraceReceipt = buildDecisionFinalAnswerTraceReceipt({
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
    validation: finalAnswerValidationReceipt
  });
  const marketPriorGovernor =
    benchmark && publicHistoricalTrainingEvidence
      ? buildDecisionMarketPriorGovernor({
          date: query.date,
          sport: query.sport,
          probabilityFusionAudit: context.probabilityFusionAudit,
          marketAlternativeArbiter: context.marketAlternativeArbiter,
          benchmark
        })
      : null;
  const trustAwareAIPacket =
    historicalLearningDossier && publicHistoricalTrainingEvidence
      ? buildDecisionTrustAwareAIPacket({
          date: query.date,
          sport: query.sport,
          preMatchTrustGate: context.preMatchTrustGate,
          evidenceInfluenceLedger: context.evidenceInfluenceLedger,
          finalAnswer: context.finalAnswerContract,
          abstentionAudit: context.abstentionAudit,
          briefing: context.decisionBriefing,
          openAiKeyDiagnostic: context.openAiKeyDiagnostic,
          openAiLiveReviewReceipt: context.openAiLiveReviewReceipt,
          historicalLearningDossier,
          publicHistoricalTrainingEvidence
        })
      : null;
  const historicalDisciplineReceipt =
    publicHistoricalTrainingEvidence && marketPriorGovernor && trustAwareAIPacket
      ? buildDecisionHistoricalDisciplineReceipt({
          date: query.date,
          sport: query.sport,
          publicHistoricalTrainingEvidence,
          marketPriorGovernor,
          marketCalibratedFusion,
          answerPromotionGate,
          trustAwareAIPacket
        })
      : null;
  const progress = buildDecisionMvpProgressReceipt({
    date: query.date,
    sport: query.sport,
    requirementPulse: context.requirementPulse,
    dataBackbone: context.dataBackbone,
    storageActivationChecklist: context.storageActivationChecklist,
    supabaseStorageProofLedger: context.supabaseStorageProofLedger,
    providerBatchManifest: context.providerBatchManifest,
    tenYearCorpusExecutionManifest: context.tenYearCorpusExecutionManifest,
    eplPreKickoffRehearsal: context.eplPreKickoffRehearsal,
    brainReviewRunner: context.brainReviewRunner,
    openAiLiveReviewReceipt: context.openAiLiveReviewReceipt,
    finalAnswerTraceReceipt,
    answerPromotionGate,
    publicHistoricalTrainingEvidence,
    historicalDisciplineReceipt
  });

  return apiSuccess(progress);
}
