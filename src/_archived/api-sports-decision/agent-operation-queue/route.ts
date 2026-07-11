import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";
import { DECISION_MULTI_SPORTS, type DecisionMultiSport } from "@/lib/sports/prediction/decisionMultiSportThinking";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 10;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  if (!DECISION_MULTI_SPORTS.includes(query.sport as DecisionMultiSport)) {
    return apiError("Agent operation queue currently supports football, basketball, and tennis.");
  }

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport as DecisionMultiSport,
    baseUrl: url.origin,
    env: process.env
  });

  return apiSuccess({
    ...context.agentOperationQueue,
    operations: context.agentOperationQueue.operations.slice(0, limit)
  });
}
