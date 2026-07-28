import { apiError, apiSuccess, parseSportsQuery, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getLiveScores } from "@/lib/sports/service";

export const GET = withApiHandler(async (request: Request) => {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const data = await getLiveScores(query.date, query.sport);
  // Matches /api/live's 30s edge window: live scores are the most-polled
  // payload on the site and this route was absorbing every hit at the origin.
  return apiSuccess(data, publicCacheInit(30, ["date", "sport"]));
});
