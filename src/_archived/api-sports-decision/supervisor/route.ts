import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { getDecisionSupervisorQueue } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  return apiSuccess(await getDecisionSupervisorQueue({ date: query.date, sport: query.sport }));
}
