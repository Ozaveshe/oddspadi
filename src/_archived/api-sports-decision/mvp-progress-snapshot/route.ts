import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import { buildDecisionProviderEnvDiagnosticFromEnv } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { getPredictions } from "@/lib/sports/service";
import { buildApiFootballEntitlementProbe } from "@/lib/sports/training/apiFootballEntitlementProbe";
import { getTrainingDataSnapshot } from "@/lib/sports/training/trainingRepository";

export const dynamic = "force-dynamic";

function enabled(value: string | null): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);
  const url = new URL(request.url);
  const entitlementRunRequested = enabled(url.searchParams.get("entitlementRun"));

  const [readiness, rows, apiFootballEntitlementProbe, trainingSnapshot] = await Promise.all([
    verifyDecisionEngineReadiness(),
    getPredictions({ date: query.date, sport: query.sport }),
    buildApiFootballEntitlementProbe({
      env: process.env,
      runRequested: entitlementRunRequested,
      adminAuthorized: isDecisionAdminAuthorized(request),
      origin: url.origin
    }),
    getTrainingDataSnapshot(query.sport)
  ]);
  const providerEnvDiagnostic = buildDecisionProviderEnvDiagnosticFromEnv({
    date: query.date,
    sport: query.sport,
    env: process.env
  });

  return apiSuccess(
    buildDecisionMvpProgressSnapshot({
      date: query.date,
      sport: query.sport,
      rows,
      readiness,
      providerEnvDiagnostic,
      apiFootballEntitlementProbe,
      trainingSnapshot
    })
  );
}
