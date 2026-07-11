import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionBrainSlate } from "@/lib/sports/prediction/decisionBrain";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 40) : 8;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const rows = await getPredictions({ date: query.date, sport: query.sport });
  return apiSuccess(buildDecisionBrainSlate({ rows, date: query.date, sport: query.sport, limit: parseLimit(url.searchParams.get("limit")) }));
}
