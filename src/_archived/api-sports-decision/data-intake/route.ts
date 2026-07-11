import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const [rows, readiness] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness()
  ]);

  return apiSuccess(buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness }));
}
