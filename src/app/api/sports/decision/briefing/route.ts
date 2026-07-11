import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionAdversarialPanel } from "@/lib/sports/prediction/decisionAdversarialPanel";
import { buildDecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import { buildDecisionBriefing, persistDecisionBriefing } from "@/lib/sports/prediction/decisionBriefing";
import { buildDecisionEvidenceGraph } from "@/lib/sports/prediction/decisionEvidenceGraph";
import { buildDecisionModelEnsemble } from "@/lib/sports/prediction/decisionModelEnsemble";
import { buildDecisionModelMathProof } from "@/lib/sports/prediction/decisionModelMathProof";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
import { buildDecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import { decisionSiteOrigin } from "@/lib/sports/prediction/decisionUrls";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 12) : 6;
}

async function buildBriefingFromRequest(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return { error: query.error };

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return { error: "Decision briefing currently supports football, basketball, and tennis." };
  }

  const url = new URL(request.url);
  const sport = query.sport as DecisionMultiSport;
  const limit = parseLimit(url.searchParams.get("limit"));
  const slates = await Promise.all(
    DECISION_MULTI_SPORTS.map(async (slateSport) => ({
      sport: slateSport,
      rows: await getPredictions({ date: query.date, sport: slateSport })
    }))
  );
  const rows = slates.find((slate) => slate.sport === sport)?.rows ?? [];
  const modelEnsemble = buildDecisionModelEnsemble({ rows, date: query.date, sport, limit });
  const modelMathProof = buildDecisionModelMathProof({ date: query.date, slates, limit });
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
    baseUrl: decisionSiteOrigin()
  });
  const openAiKeyDiagnostic = buildDecisionOpenAIKeyDiagnostic({ aiReviewReadiness, env: process.env });

  return {
    briefing: buildDecisionBriefing({
      date: query.date,
      sport,
      modelMathProof,
      oddsIntelligenceProof,
      adversarialPanel,
      openAiKeyDiagnostic
    })
  };
}

export async function GET(request: Request) {
  const result = await buildBriefingFromRequest(request);
  if ("error" in result) return apiError(result.error ?? "Unable to build decision briefing.");
  return apiSuccess(result.briefing);
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("Decision briefing writes require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const result = await buildBriefingFromRequest(request);
  if ("error" in result) return apiError(result.error ?? "Unable to build decision briefing.");

  const persistence = await persistDecisionBriefing(result.briefing);
  return apiSuccess({
    ...result.briefing,
    persistence
  });
}
