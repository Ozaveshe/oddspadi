import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionAnswerPromotionGate } from "@/lib/sports/prediction/decisionAnswerPromotionGate";
import { buildDecisionEvidenceSufficiencyScore } from "@/lib/sports/prediction/decisionEvidenceSufficiencyScore";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildDecisionMarketCalibratedFusion } from "@/lib/sports/prediction/decisionMarketCalibratedFusion";
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

  if (!isEnabled(url.searchParams.get("benchmark"))) return apiSuccess(context.evidenceSufficiencyScore);

  const benchmark = await buildFootballDataMarketBenchmark({
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons")),
    trainRatio: parseNumber(url.searchParams.get("trainRatio")),
    minEdge: parseNumber(url.searchParams.get("minEdge")),
    minModelProbability: parseNumber(url.searchParams.get("minModelProbability"))
  });
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
    eplFixtureIntake: query.sport === "football" ? context.eplFixtureIntake : null
  });
  const score = buildDecisionEvidenceSufficiencyScore({
    date: query.date,
    sport: query.sport,
    liveDataReadiness: context.liveDataReadiness,
    modelMathProof: context.modelMathProof,
    marketCalibratedFusion,
    abstentionAudit: context.abstentionAudit,
    finalAnswer: context.finalAnswerContract,
    answerPromotionGate,
    eplPreKickoffRehearsal: context.eplPreKickoffRehearsal
  });

  return apiSuccess({
    ...score,
    benchmark
  });
}
