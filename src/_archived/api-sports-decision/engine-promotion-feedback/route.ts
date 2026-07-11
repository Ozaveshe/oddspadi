import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import type { DecisionEngineNextActionController } from "@/lib/sports/prediction/decisionEngineNextActionController";
import { buildDecisionEnginePromotionFeedback } from "@/lib/sports/prediction/decisionEnginePromotionFeedback";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import type { FootballDataModelPromotionDecision } from "@/lib/sports/training/footballDataModelPromotionDecision";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  if (query.sport !== "football") return apiError("Engine promotion feedback currently supports football promotion gates.");

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const controller = await fetchDecisionApiData<DecisionEngineNextActionController>(
    new URL(`/api/sports/decision/engine-next-action-controller?date=${query.date}&sport=${query.sport}&limit=${limit}`, url.origin),
    {
      timeoutMs: 320000,
      maxAttempts: 1
    }
  );
  if (!controller) return apiError("Unable to build next-action controller before promotion feedback.", 502);

  const promotionDecision = await fetchDecisionApiData<FootballDataModelPromotionDecision>(
    new URL("/api/sports/decision/training/football-data-model-promotion-decision?dryRun=1", url.origin),
    {
      timeoutMs: 300000,
      maxAttempts: 1
    }
  );
  if (!promotionDecision) return apiError("Unable to build read-only football promotion decision before promotion feedback.", 502);

  return apiSuccess(buildDecisionEnginePromotionFeedback({ controller, promotion: promotionDecision }));
}
