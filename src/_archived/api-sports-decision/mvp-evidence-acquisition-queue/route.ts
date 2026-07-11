import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import { buildDecisionMvpEvidenceAcquisitionQueue } from "@/lib/sports/prediction/decisionMvpEvidenceAcquisitionQueue";
import { buildDecisionProviderEnvDiagnosticFromEnv } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import { buildDecisionProviderUnlockSnapshot } from "@/lib/sports/prediction/decisionProviderUnlockSnapshot";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 20) : 8;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const [rows, providerEnvDiagnostic, liveProviderProbeLedger] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
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
  const slateThinking = buildDecisionSlateThinking({ rows, date: query.date, sport: query.sport, limit: Math.max(8, limit) });
  const providerUnlockSnapshot = buildDecisionProviderUnlockSnapshot({
    date: query.date,
    sport: query.sport,
    providerEnvDiagnostic,
    liveProviderProbeLedger
  });

  return apiSuccess(
    buildDecisionMvpEvidenceAcquisitionQueue({
      date: query.date,
      sport: query.sport,
      slateThinking,
      providerUnlockSnapshot,
      limit
    })
  );
}
