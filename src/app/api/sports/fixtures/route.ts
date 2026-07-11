import { apiError, apiSuccess, parseSportsQuery, withApiHandler } from "@/app/api/sports/_utils";
import { sportsProvider } from "@/lib/sports/service";

export const GET = withApiHandler(async (request: Request) => {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const data = await sportsProvider.getFixtures(query.date, query.sport);
  return apiSuccess(data);
});
