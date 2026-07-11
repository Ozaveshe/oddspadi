import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { getCalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionLearningQueue } from "@/lib/sports/prediction/decisionLearningQueue";
import { getDecisionMemorySnapshot } from "@/lib/sports/prediction/decisionMemory";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { getPredictions } from "@/lib/sports/service";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const [rows, readiness, memory, calibration, training] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    getDecisionMemorySnapshot({ limit: 8 }),
    getCalibrationSnapshot(query.sport),
    getTrainingDataSnapshot(query.sport)
  ]);

  return apiSuccess(buildDecisionLearningQueue({ rows, date: query.date, sport: query.sport, readiness, memory, calibration, training }));
}
