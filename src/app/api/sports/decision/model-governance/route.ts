import { apiError, apiSuccess, parsePredictionFilters, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { getPredictions } from "@/lib/sports/service";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const filters = parsePredictionFilters(request);

  const [rows, training] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport, ...filters }),
    getTrainingDataSnapshot(query.sport)
  ]);
  const matrix = buildDecisionFeatureMatrix({ rows, date: query.date, sport: query.sport, limit: 8 });

  return apiSuccess(buildDecisionModelGovernance({ matrix, training, date: query.date, sport: query.sport }));
}
