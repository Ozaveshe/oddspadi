import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionProviderIngestionEvidence } from "@/lib/sports/prediction/decisionProviderIngestionEvidence";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { getPredictions } from "@/lib/sports/service";
import { buildTenYearFootballCorpusBackfillPlan } from "@/lib/sports/training/corpusBackfillPlan";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const [rows, readiness, training, corpusPlan] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    getTrainingDataSnapshot(query.sport),
    buildTenYearFootballCorpusBackfillPlan({ baseUrl: url.origin })
  ]);
  const dataIntake = buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness, limit: 12 });

  return apiSuccess(
    buildDecisionProviderIngestionEvidence({
      date: query.date,
      sport: query.sport,
      dataIntake,
      readiness,
      training,
      corpusPlan,
      baseUrl: url.origin
    })
  );
}
