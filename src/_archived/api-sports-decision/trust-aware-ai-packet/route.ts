import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { buildDecisionTrustAwareAIPacket } from "@/lib/sports/prediction/decisionTrustAwareAIPacket";
import { buildFootballDataHistoricalLearningDossier } from "@/lib/sports/training/footballDataHistoricalLearningDossier";
import { buildPublicHistoricalTrainingEvidence } from "@/lib/sports/training/publicHistoricalTrainingEvidence";

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

  const historicalRequested = isEnabled(url.searchParams.get("historical")) || isEnabled(url.searchParams.get("publicHistory"));
  if (!historicalRequested) return apiSuccess(context.trustAwareAIPacket);

  const historicalLearningDossier = await buildFootballDataHistoricalLearningDossier({
    seasonFrom: parsePositiveInteger(url.searchParams.get("seasonFrom")),
    seasonTo: parsePositiveInteger(url.searchParams.get("seasonTo")),
    maxSeasons: parsePositiveInteger(url.searchParams.get("maxSeasons")),
    trainRatio: parseNumber(url.searchParams.get("trainRatio")),
    minEdge: parseNumber(url.searchParams.get("minEdge")),
    minModelProbability: parseNumber(url.searchParams.get("minModelProbability")),
    minPickCount: parsePositiveInteger(url.searchParams.get("minPickCount")),
    minTrainingSeasons: parsePositiveInteger(url.searchParams.get("minTrainingSeasons"))
  });
  const publicHistoricalTrainingEvidence = buildPublicHistoricalTrainingEvidence({
    dossier: historicalLearningDossier
  });
  const packet = buildDecisionTrustAwareAIPacket({
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

  return apiSuccess({
    ...packet,
    historicalLearningDossier,
    publicHistoricalTrainingEvidence
  });
}
