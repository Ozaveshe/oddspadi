import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { getValuePicks } from "@/lib/sports/service";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const data = await getValuePicks(query.date, query.sport, "live");
  return apiSuccess(data);
}
