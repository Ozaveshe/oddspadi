import { apiError, apiSuccess, parsePredictionFilters, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLaunchContext } from "@/lib/sports/prediction/decisionLaunchContext";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const filters = parsePredictionFilters(request);
  const context = await buildDecisionLaunchContext({
    date: query.date,
    sport: query.sport,
    baseUrl: url.origin,
    env: process.env,
    league: filters.league,
    country: filters.country,
    query: filters.query,
    confidence: filters.confidence
  });

  return apiSuccess(context.probabilityFusionAudit);
}
