import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { buildDecisionWorkingMemory } from "@/lib/sports/prediction/decisionWorkingMemory";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 80) : 24;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const rows = await getPredictions({ date: query.date, sport: query.sport });
  const slateThinking = buildDecisionSlateThinking({ rows, date: query.date, sport: query.sport, limit: 12 });

  return apiSuccess(
    buildDecisionWorkingMemory({
      rows,
      date: query.date,
      sport: query.sport,
      slateThinking,
      limit: parseLimit(url.searchParams.get("limit"))
    })
  );
}
