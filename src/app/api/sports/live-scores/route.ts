import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { getLiveScores } from "@/lib/sports/service";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const data = await getLiveScores(query.date, query.sport);
  return apiSuccess(data);
}
