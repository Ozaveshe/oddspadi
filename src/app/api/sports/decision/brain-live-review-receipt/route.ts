import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionBrainLiveReviewReceipt } from "@/lib/sports/prediction/decisionBrainLiveReviewReceipt";
import { runDecisionBrainReview } from "@/lib/sports/prediction/decisionBrainReviewRunner";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
}

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 30) : 12;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision brain live review receipt currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const runRequested = shouldRun(url);
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI brain review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const runner = runRequested
    ? await runDecisionBrainReview({
        packet: context.brainReviewPacket,
        runRequested: true,
        env: process.env
      })
    : context.brainReviewRunner;
  const receipt = buildDecisionBrainLiveReviewReceipt({
    packet: context.brainReviewPacket,
    runner
  });

  return apiSuccess({
    ...receipt,
    review: {
      ...receipt.review,
      requiredEvidence: receipt.review.requiredEvidence.slice(0, limit),
      riskFlags: receipt.review.riskFlags.slice(0, limit),
      unsupportedClaims: receipt.review.unsupportedClaims.slice(0, limit)
    }
  });
}
