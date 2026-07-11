import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import { DECISION_MULTI_SPORTS } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 30) : 12;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const slates = await Promise.all(
    DECISION_MULTI_SPORTS.map(async (sport) => ({
      sport,
      rows: await getPredictions({ date: query.date, sport })
    }))
  );
  const board = buildDecisionOddsBoard({ date: query.date, slates, limit: Math.max(40, limit * 4) });

  return apiSuccess(buildDecisionPortfolioRisk({ board, limit }));
}
