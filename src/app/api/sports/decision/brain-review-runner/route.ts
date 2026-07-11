import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { runDecisionBrainReview } from "@/lib/sports/prediction/decisionBrainReviewRunner";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 30) : 14;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Decision brain review runner currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const runRequested = url.searchParams.get("run") === "1";
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI brain review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });
  const runner = await runDecisionBrainReview({
    packet: context.brainReviewPacket,
    runRequested,
    env: process.env
  });

  return apiSuccess({
    ...runner,
    requestPreview: {
      ...runner.requestPreview,
      input: runner.requestPreview.input.map((item) => ({
        ...item,
        content: typeof item.content === "string" ? item.content.slice(0, 4000) : item.content
      }))
    },
    deterministicFallback: {
      ...runner.deterministicFallback,
      evidenceFindings: runner.deterministicFallback.evidenceFindings.slice(0, limit),
      requiredEvidence: runner.deterministicFallback.requiredEvidence.slice(0, limit),
      riskFlags: runner.deterministicFallback.riskFlags.slice(0, limit),
      unsupportedClaims: runner.deterministicFallback.unsupportedClaims.slice(0, limit)
    },
    review: runner.review
      ? {
          ...runner.review,
          evidenceFindings: runner.review.evidenceFindings.slice(0, limit),
          requiredEvidence: runner.review.requiredEvidence.slice(0, limit),
          riskFlags: runner.review.riskFlags.slice(0, limit),
          unsupportedClaims: runner.review.unsupportedClaims.slice(0, limit)
        }
      : null,
    appliedReview: {
      ...runner.appliedReview,
      evidenceFindings: runner.appliedReview.evidenceFindings.slice(0, limit),
      requiredEvidence: runner.appliedReview.requiredEvidence.slice(0, limit),
      riskFlags: runner.appliedReview.riskFlags.slice(0, limit),
      unsupportedClaims: runner.appliedReview.unsupportedClaims.slice(0, limit)
    }
  });
}
