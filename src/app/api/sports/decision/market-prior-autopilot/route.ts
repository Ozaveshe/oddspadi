import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import type { DecisionEngineNextActionController } from "@/lib/sports/prediction/decisionEngineNextActionController";
import type { DecisionEnginePromotionFeedback } from "@/lib/sports/prediction/decisionEnginePromotionFeedback";
import { buildDecisionMarketPriorAutopilot } from "@/lib/sports/prediction/decisionMarketPriorAutopilot";
import { buildDecisionMarketPriorBlockerResolver } from "@/lib/sports/prediction/decisionMarketPriorBlockerResolver";
import { buildDecisionMarketPriorLoopReceipt } from "@/lib/sports/prediction/decisionMarketPriorLoopReceipt";
import { buildDecisionMarketPriorResolutionTurn } from "@/lib/sports/prediction/decisionMarketPriorResolutionTurn";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import type { DecisionMarketPriorGovernor } from "@/lib/sports/prediction/decisionMarketPriorGovernor";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

function isEnabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  if (query.sport !== "football") return apiError("Market-prior autopilot currently supports football promotion evidence.");

  const url = new URL(request.url);
  const dryRun = url.searchParams.get("dryRun");
  if (dryRun === "0" || dryRun?.toLowerCase() === "false") return apiError("market-prior-autopilot is read-only; use dryRun=1.", 400);

  const limit = parseLimit(url.searchParams.get("limit"));
  const run = isEnabled(url.searchParams.get("run"));
  const qs = `date=${query.date}&sport=${query.sport}&limit=${limit}`;

  const [controller, promotionFeedback, marketPriorGovernor] = await Promise.all([
    fetchDecisionApiData<DecisionEngineNextActionController>(new URL(`/api/sports/decision/engine-next-action-controller?${qs}`, url.origin), {
      timeoutMs: 260000,
      maxAttempts: 1
    }),
    fetchDecisionApiData<DecisionEnginePromotionFeedback>(new URL(`/api/sports/decision/engine-promotion-feedback?${qs}`, url.origin), {
      timeoutMs: 440000,
      maxAttempts: 1
    }),
    fetchDecisionApiData<DecisionMarketPriorGovernor>(new URL(`/api/sports/decision/market-prior-governor?date=${query.date}&sport=${query.sport}&benchmark=1`, url.origin), {
      timeoutMs: 300000,
      maxAttempts: 1
    })
  ]);

  if (!controller) return apiError("Unable to build next-action controller before market-prior autopilot.", 502);
  if (!promotionFeedback) return apiError("Unable to build promotion feedback before market-prior autopilot.", 502);

  const resolver = buildDecisionMarketPriorBlockerResolver({
    promotionFeedback,
    marketPriorGovernor
  });

  const turn = await buildDecisionMarketPriorResolutionTurn({
    resolver,
    runRequested: run,
    origin: url.origin
  });
  const loopReceipt = buildDecisionMarketPriorLoopReceipt({ turn });

  return apiSuccess(
    buildDecisionMarketPriorAutopilot({
      controller,
      promotionFeedback,
      resolver,
      turn,
      loopReceipt
    })
  );
}
