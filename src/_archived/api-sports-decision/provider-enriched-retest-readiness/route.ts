import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import { buildDecisionHistoricalDisciplineReceipt } from "@/lib/sports/prediction/decisionHistoricalDisciplineReceipt";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildDecisionMarketCalibratedFusion } from "@/lib/sports/prediction/decisionMarketCalibratedFusion";
import { buildDecisionMarketPriorGovernor } from "@/lib/sports/prediction/decisionMarketPriorGovernor";
import { observeDecisionEplOddsDryRunReceipt } from "@/lib/sports/prediction/decisionEplOddsDryRunReceipt";
import { observeDecisionEplProviderDryRunReceipt } from "@/lib/sports/prediction/decisionEplProviderDryRunReceipt";
import { buildDecisionProviderDryRunObservationLedger } from "@/lib/sports/prediction/decisionProviderDryRunObservationLedger";
import { buildDecisionProviderEnrichedRetestReadiness } from "@/lib/sports/prediction/decisionProviderEnrichedRetestReadiness";
import { buildDecisionProviderSubscriptionPlanner } from "@/lib/sports/prediction/decisionProviderSubscriptionPlanner";
import { buildDecisionTrustAwareAIPacket } from "@/lib/sports/prediction/decisionTrustAwareAIPacket";
import { buildFootballDataHistoricalPromotionProof } from "@/lib/sports/training/footballDataHistoricalPromotionProof";

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
  if (query.sport !== "football") return apiError("provider-enriched-retest-readiness is currently available for football only.");

  const url = new URL(request.url);
  const runRequested = isEnabled(url.searchParams.get("run"));
  const adminAuthorized = isDecisionAdminAuthorized(request);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport,
    baseUrl: url.origin,
    env: process.env
  });
  const historicalProof = await buildFootballDataHistoricalPromotionProof({
    baseUrl: url.origin,
    env: process.env,
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons")),
    trainRatio: parseNumber(url.searchParams.get("trainRatio")),
    minEdge: parseNumber(url.searchParams.get("minEdge")),
    minModelProbability: parseNumber(url.searchParams.get("minModelProbability")),
    minPickCount: parsePositiveInteger(url.searchParams.get("minPickCount")),
    minTrainingSeasons: parsePositiveInteger(url.searchParams.get("minTrainingSeasons")),
    minSample: parsePositiveInteger(url.searchParams.get("minSample")) ?? 30,
    limit: parsePositiveInteger(url.searchParams.get("limit")),
    includePublicHistory: true,
    includeBridge: true,
    includeModelPromotion: true
  });
  const { historicalLearningDossier, publicHistoricalTrainingEvidence, benchmark } = historicalProof;
  if (!historicalLearningDossier || !publicHistoricalTrainingEvidence || !benchmark) {
    return apiError("Historical promotion proof could not be built.", 502);
  }

  const marketCalibratedFusion = buildDecisionMarketCalibratedFusion({
    date: query.date,
    sport: query.sport,
    probabilityFusionAudit: context.probabilityFusionAudit,
    benchmark
  });
  const marketPriorGovernor = buildDecisionMarketPriorGovernor({
    date: query.date,
    sport: query.sport,
    probabilityFusionAudit: context.probabilityFusionAudit,
    marketAlternativeArbiter: context.marketAlternativeArbiter,
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
    publicHistoryBacktestBridge: historicalProof.publicHistoryBacktestBridge,
    modelPromotionDecision: historicalProof.modelPromotionDecision,
    eplFixtureIntake: context.eplFixtureIntake
  });
  const trustAwareAIPacket = buildDecisionTrustAwareAIPacket({
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
  });
  const historicalDiscipline = buildDecisionHistoricalDisciplineReceipt({
    date: query.date,
    sport: query.sport,
    publicHistoricalTrainingEvidence,
    marketPriorGovernor,
    marketCalibratedFusion,
    answerPromotionGate,
    trustAwareAIPacket
  });
  const [eplProviderDryRunReceipt, eplOddsDryRunReceipt] = await Promise.all([
    observeDecisionEplProviderDryRunReceipt({
      intake: context.eplFixtureIntake,
      runRequested,
      adminAuthorized,
      env: process.env,
      origin: url.origin
    }),
    observeDecisionEplOddsDryRunReceipt({
      oddsMap: context.eplOddsMarketMap,
      runRequested,
      adminAuthorized,
      env: process.env,
      origin: url.origin
    })
  ]);
  const providerDryRunObservationLedger = buildDecisionProviderDryRunObservationLedger({
    eplProviderDryRunReceipt,
    eplOddsDryRunReceipt,
    runRequested,
    adminAuthorized
  });
  const providerSubscriptionPlanner = buildDecisionProviderSubscriptionPlanner({
    date: query.date,
    sport: query.sport,
    providerActivationQueue: context.providerActivationQueue,
    providerKeyPlan: context.providerActivationQueue.providerKeyPlan,
    apiFootballPlan: url.searchParams.get("apiFootballPlan"),
    oddsApiPlan: url.searchParams.get("oddsApiPlan"),
    env: process.env
  });

  return apiSuccess(
    buildDecisionProviderEnrichedRetestReadiness({
      date: query.date,
      sport: query.sport,
      historicalDiscipline,
      providerDryRunObservationLedger,
      providerSubscriptionPlanner
    })
  );
}
