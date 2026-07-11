import { apiError, apiSuccess, parsePredictionFilters, parseSportsQuery } from "@/app/api/sports/_utils";
import { getCalibrationSnapshot } from "@/lib/sports/prediction/decisionCalibration";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { buildDecisionModelTrust } from "@/lib/sports/prediction/decisionModelTrust";
import { buildDecisionOddsBoard } from "@/lib/sports/prediction/decisionOddsBoard";
import { buildDecisionPortfolioRisk } from "@/lib/sports/prediction/decisionPortfolioRisk";
import { DECISION_MULTI_SPORTS } from "@/lib/sports/prediction/decisionMultiSportThinking";
import { getPredictions } from "@/lib/sports/service";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const filters = parsePredictionFilters(request);

  const [rows, training, calibration, slates] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport, ...filters }),
    getTrainingDataSnapshot(query.sport),
    getCalibrationSnapshot(query.sport),
    Promise.all(
      DECISION_MULTI_SPORTS.map(async (sport) => ({
        sport,
        rows: await getPredictions({
          date: query.date,
          sport,
          league: sport === query.sport ? filters.league : undefined,
          country: sport === query.sport ? filters.country : undefined,
          query: sport === query.sport ? filters.query : undefined,
          confidence: sport === query.sport ? filters.confidence : undefined
        })
      }))
    )
  ]);
  const matrix = buildDecisionFeatureMatrix({ rows, date: query.date, sport: query.sport, limit: 8 });
  const governance = buildDecisionModelGovernance({ matrix, training, date: query.date, sport: query.sport });
  const board = buildDecisionOddsBoard({ date: query.date, slates, limit: 40 });
  const portfolio = buildDecisionPortfolioRisk({ board, limit: 12 });

  return apiSuccess(buildDecisionModelTrust({ date: query.date, sport: query.sport, governance, calibration, training, board, portfolio }));
}
