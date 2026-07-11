import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { sportsProvider } from "@/lib/sports/service";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const data = await sportsProvider.getFixtures(query.date, query.sport);
  return apiSuccess(data);
}
