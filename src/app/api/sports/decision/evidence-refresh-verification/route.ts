import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { getCalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionEvidenceRefreshScheduler } from "@/lib/sports/prediction/decisionEvidenceRefreshScheduler";
import { buildDecisionEvidenceRefreshVerifier } from "@/lib/sports/prediction/decisionEvidenceRefreshVerifier";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import { DECISION_MULTI_SPORTS } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSignalReliability } from "@/lib/sports/prediction/decisionSignalReliability";
import { getPredictions } from "@/lib/sports/service";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 40) : 14;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const [rows, readiness, training, calibration, slates] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    getTrainingDataSnapshot(query.sport),
    getCalibrationSnapshot(query.sport),
    Promise.all(
      DECISION_MULTI_SPORTS.map(async (sport) => ({
        sport,
        rows: await getPredictions({ date: query.date, sport })
      }))
    )
  ]);
  const dataIntake = buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness, limit: 12 });
  const signalReliability = buildDecisionSignalReliability({ rows, date: query.date, sport: query.sport, dataIntake });
  const matrix = buildDecisionFeatureMatrix({ rows, date: query.date, sport: query.sport, limit: 8 });
  const governance = buildDecisionModelGovernance({ matrix, training, date: query.date, sport: query.sport });
  const oddsBoard = buildDecisionOddsBoard({ date: query.date, slates, limit: 40 });
  const portfolioRisk = buildDecisionPortfolioRisk({ board: oddsBoard, limit: 12 });
  const modelTrust = buildDecisionModelTrust({ date: query.date, sport: query.sport, governance, calibration, training, board: oddsBoard, portfolio: portfolioRisk });
  const scheduler = buildDecisionEvidenceRefreshScheduler({
    rows,
    date: query.date,
    sport: query.sport,
    dataIntake,
    signalReliability,
    modelTrust,
    oddsBoard,
    portfolioRisk,
    limit: parseLimit(url.searchParams.get("limit"))
  });

  return apiSuccess(buildDecisionEvidenceRefreshVerifier({ scheduler, signalReliability, dataIntake, modelTrust, portfolioRisk, oddsBoard }));
}
