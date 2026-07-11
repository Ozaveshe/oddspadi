import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import { buildDecisionProviderEnvDiagnosticFromEnv } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import { buildDecisionProviderUnlockSnapshot } from "@/lib/sports/prediction/decisionProviderUnlockSnapshot";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const [providerEnvDiagnostic, liveProviderProbeLedger] = await Promise.all([
    buildDecisionProviderEnvDiagnosticFromEnv({
      date: query.date,
      sport: query.sport,
      env: process.env
    }),
    buildDecisionLiveProviderProbeLedger({
      date: query.date,
      sport: query.sport,
      env: process.env,
      runRequested: false,
      adminAuthorized: false
    })
  ]);

  return apiSuccess(
    buildDecisionProviderUnlockSnapshot({
      date: query.date,
      sport: query.sport,
      providerEnvDiagnostic,
      liveProviderProbeLedger
    })
  );
}
