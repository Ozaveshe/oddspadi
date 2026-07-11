import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionAdversarialPanel } from "@/lib/sports/prediction/decisionAdversarialPanel";
import { buildDecisionAgentThoughtBoard } from "@/lib/sports/prediction/decisionAgentThoughtBoard";
import { buildDecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import { buildDecisionEvidenceGraph } from "@/lib/sports/prediction/decisionEvidenceGraph";
import { buildDecisionModelEnsemble } from "@/lib/sports/prediction/decisionModelEnsemble";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import { buildDecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import { buildDecisionOpenAILiveReviewReceipt } from "@/lib/sports/prediction/decisionOpenAILiveReviewReceipt";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 12) : 6;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Agent thought board currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const sport = query.sport as DecisionMultiSport;
  const limit = parseLimit(url.searchParams.get("limit"));
  const rows = await getPredictions({ date: query.date, sport });
  const modelEnsemble = buildDecisionModelEnsemble({ rows, date: query.date, sport, limit });
  const oddsBoard = buildDecisionOddsBoard({ date: query.date, slates: [{ sport, rows }], limit: 80 });
  const oddsIntelligenceProof = buildDecisionOddsIntelligenceProof({ board: oddsBoard, limit: Math.max(limit, 8) });
  const slateThinking = buildDecisionSlateThinking({ rows, date: query.date, sport, limit });
  const evidenceGraph = buildDecisionEvidenceGraph({ rows, date: query.date, sport, slateThinking, limit });
  const adversarialPanel = buildDecisionAdversarialPanel({
    date: query.date,
    sport,
    modelEnsemble,
    oddsIntelligenceProof,
    evidenceGraph,
    limit
  });
  const aiReviewReadiness = buildDecisionAIReviewReadiness({
    date: query.date,
    sport,
    env: process.env,
    baseUrl: url.origin
  });
  const openAiKeyDiagnostic = buildDecisionOpenAIKeyDiagnostic({ aiReviewReadiness, env: process.env });
  const openAiLiveReviewReceipt = buildDecisionOpenAILiveReviewReceipt({ aiReviewReadiness, openAiKeyDiagnostic });

  return apiSuccess(
    buildDecisionAgentThoughtBoard({
      date: query.date,
      sport,
      modelEnsemble,
      slateThinking,
      evidenceGraph,
      adversarialPanel,
      openAiLiveReviewReceipt
    })
  );
}
