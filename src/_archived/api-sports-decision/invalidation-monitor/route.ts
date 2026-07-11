import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionInvalidationMonitor } from "@/lib/sports/prediction/decisionInvalidationMonitor";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { getPredictions } from "@/lib/sports/service";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 40) : 12;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const [rows, readiness, training] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    getTrainingDataSnapshot(query.sport)
  ]);
  const dataIntake = buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness, limit: 10 });
  const matrix = buildDecisionFeatureMatrix({ rows, date: query.date, sport: query.sport, limit: 8 });
  const governance = buildDecisionModelGovernance({ matrix, training, date: query.date, sport: query.sport });

  return apiSuccess(
    buildDecisionInvalidationMonitor({
      rows,
      date: query.date,
      sport: query.sport,
      dataIntake,
      governance,
      limit: parseLimit(url.searchParams.get("limit"))
    })
  );
}
