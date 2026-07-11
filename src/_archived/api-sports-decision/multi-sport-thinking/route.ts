import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionMultiSportThinking, DECISION_MULTI_SPORTS } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, DECISION_MULTI_SPORTS.length) : DECISION_MULTI_SPORTS.length;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const slates = await Promise.all(
    DECISION_MULTI_SPORTS.map(async (sport) => ({
      sport,
      rows: await getPredictions({ date: query.date, sport })
    }))
  );

  return apiSuccess(buildDecisionMultiSportThinking({ date: query.date, slates, limit: parseLimit(url.searchParams.get("limit")) }));
}
