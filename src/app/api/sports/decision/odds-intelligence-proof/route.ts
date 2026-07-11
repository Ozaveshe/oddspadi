import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionOddsIntelligenceProof } from "@/lib/sports/prediction/decisionOddsIntelligenceProof";
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
  const slates = await Promise.all(
    DECISION_MULTI_SPORTS.map(async (sport) => ({
      sport,
      rows: await getPredictions({ date: query.date, sport })
    }))
  );
  const board = buildDecisionOddsBoard({ date: query.date, slates, limit: 80 });

  return apiSuccess(buildDecisionOddsIntelligenceProof({ board, limit: parseLimit(url.searchParams.get("limit")) }));
}
