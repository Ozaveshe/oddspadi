import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import { buildDecisionMvpActivationQueue } from "@/lib/sports/prediction/decisionMvpActivationQueue";
import { buildDecisionMvpBriefCoverageSnapshot } from "@/lib/sports/prediction/decisionMvpBriefCoverageSnapshot";
import { buildDecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import { buildDecisionProviderEnvDiagnosticFromEnv } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const [readiness, rows, liveProviderProbeLedger] = await Promise.all([
    verifyDecisionEngineReadiness(),
    getPredictions({ date: query.date, sport: query.sport }),
    buildDecisionLiveProviderProbeLedger({
      date: query.date,
      sport: query.sport,
      env: process.env,
      runRequested: false,
      adminAuthorized: false
    })
  ]);
  const providerEnvDiagnostic = buildDecisionProviderEnvDiagnosticFromEnv({
    date: query.date,
    sport: query.sport,
    env: process.env
  });
  const mvpProgressSnapshot = buildDecisionMvpProgressSnapshot({
    date: query.date,
    sport: query.sport,
    rows,
    readiness,
    providerEnvDiagnostic
  });
  const slateThinking = buildDecisionSlateThinking({ rows, date: query.date, sport: query.sport, limit: 8 });
  const mvpActivationQueue = buildDecisionMvpActivationQueue({
    date: query.date,
    sport: query.sport,
    providerEnvDiagnostic,
    mvpProgressSnapshot,
    liveProviderProbeLedger,
    slateThinking
  });

  return apiSuccess(
    buildDecisionMvpBriefCoverageSnapshot({
      date: query.date,
      sport: query.sport,
      providerEnvDiagnostic,
      mvpProgressSnapshot,
      liveProviderProbeLedger,
      slateThinking,
      mvpActivationQueue
    })
  );
}
