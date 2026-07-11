import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import { runDecisionAIContextDossierReview } from "@/lib/sports/prediction/decisionAIContextDossier";
import { buildDecisionDataIntakeQueue } from "@/lib/sports/prediction/decisionDataIntakeQueue";
import { buildDecisionFeatureMatrix } from "@/lib/sports/prediction/decisionFeatureMatrix";
import { buildDecisionModelEnsemble } from "@/lib/sports/prediction/decisionModelEnsemble";
import { buildDecisionModelGovernance } from "@/lib/sports/prediction/decisionModelGovernance";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { getPredictions } from "@/lib/sports/service";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 6;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const runRequested =
    url.searchParams.get("run") === "1" ||
    url.searchParams.get("run") === "true" ||
    url.searchParams.get("review") === "1" ||
    url.searchParams.get("review") === "true";
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI context review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const [readiness, rows, training] = await Promise.all([
    verifyDecisionEngineReadiness(),
    getPredictions({ date: query.date, sport: query.sport }),
    getTrainingDataSnapshot(query.sport)
  ]);
  const modelEnsemble = buildDecisionModelEnsemble({ rows, date: query.date, sport: query.sport, limit });
  const featureMatrix = buildDecisionFeatureMatrix({ rows, date: query.date, sport: query.sport, limit });
  const modelGovernance = buildDecisionModelGovernance({ matrix: featureMatrix, training, date: query.date, sport: query.sport });
  const dataIntake = buildDecisionDataIntakeQueue({ rows, date: query.date, sport: query.sport, readiness, limit });

  return apiSuccess(
    await runDecisionAIContextDossierReview({
      rows,
      date: query.date,
      sport: query.sport,
      modelEnsemble,
      featureMatrix,
      modelGovernance,
      dataIntake,
      runRequested
    })
  );
}
