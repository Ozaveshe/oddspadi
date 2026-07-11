import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import { buildDecisionMvpEvidenceAcquisitionQueue } from "@/lib/sports/prediction/decisionMvpEvidenceAcquisitionQueue";
import { buildDecisionMvpProviderSetupPacket } from "@/lib/sports/prediction/decisionMvpProviderSetupPacket";
import { buildDecisionProviderEnvDiagnosticFromEnv } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import { buildDecisionProviderUnlockSnapshot } from "@/lib/sports/prediction/decisionProviderUnlockSnapshot";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { getPredictions } from "@/lib/sports/service";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const [rows, liveProviderProbeLedger] = await Promise.all([
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
  const providerUnlockSnapshot = buildDecisionProviderUnlockSnapshot({
    date: query.date,
    sport: query.sport,
    providerEnvDiagnostic,
    liveProviderProbeLedger
  });
  const slateThinking = buildDecisionSlateThinking({ rows, date: query.date, sport: query.sport, limit });
  const evidenceQueue = buildDecisionMvpEvidenceAcquisitionQueue({
    date: query.date,
    sport: query.sport,
    slateThinking,
    providerUnlockSnapshot,
    limit
  });

  return apiSuccess(
    buildDecisionMvpProviderSetupPacket({
      date: query.date,
      sport: query.sport,
      providerUnlockSnapshot,
      evidenceQueue
    })
  );
}
