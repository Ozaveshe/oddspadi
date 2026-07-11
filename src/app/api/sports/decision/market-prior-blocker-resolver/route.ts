import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import type { DecisionEnginePromotionFeedback } from "@/lib/sports/prediction/decisionEnginePromotionFeedback";
import { buildDecisionMarketPriorBlockerResolver } from "@/lib/sports/prediction/decisionMarketPriorBlockerResolver";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import type { DecisionMarketPriorGovernor } from "@/lib/sports/prediction/decisionMarketPriorGovernor";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  if (query.sport !== "football") return apiError("Market-prior blocker resolver currently supports football promotion evidence.");

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("market-prior-blocker-resolver is read-only; use dryRun=1.", 400);

  const limit = parseLimit(url.searchParams.get("limit"));
  const promotionFeedback = await fetchDecisionApiData<DecisionEnginePromotionFeedback>(
    new URL(`/api/sports/decision/engine-promotion-feedback?date=${query.date}&sport=${query.sport}&limit=${limit}`, url.origin),
    {
      timeoutMs: 420000,
      maxAttempts: 1
    }
  );
  if (!promotionFeedback) return apiError("Unable to build promotion feedback before market-prior blocker resolver.", 502);

  const marketPriorGovernor = await fetchDecisionApiData<DecisionMarketPriorGovernor>(
    new URL(`/api/sports/decision/market-prior-governor?date=${query.date}&sport=${query.sport}&benchmark=1`, url.origin),
    {
      timeoutMs: 300000,
      maxAttempts: 1
    }
  );

  return apiSuccess(
    buildDecisionMarketPriorBlockerResolver({
      promotionFeedback,
      marketPriorGovernor
    })
  );
}
