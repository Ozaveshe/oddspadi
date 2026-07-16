import { apiError, apiSuccess, parseSportsQuery, publicCacheInit, withApiHandler } from "@/app/api/sports/_utils";
import { getValuePicks } from "@/lib/sports/service";

export const GET = withApiHandler(async (request: Request) => {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const data = await getValuePicks(query.date, query.sport, "live", "preview");
  return apiSuccess(data, publicCacheInit(120, ["date", "sport"]));
});
