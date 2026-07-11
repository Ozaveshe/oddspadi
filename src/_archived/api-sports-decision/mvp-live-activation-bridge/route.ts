import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { hasAnyConfiguredEnv } from "@/lib/env";
import { buildDecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import { buildDecisionMvpEvidenceAcquisitionQueue } from "@/lib/sports/prediction/decisionMvpEvidenceAcquisitionQueue";
import { buildDecisionMvpLiveActivationBridge } from "@/lib/sports/prediction/decisionMvpLiveActivationBridge";
import { buildDecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import { buildDecisionMvpProviderProofGate } from "@/lib/sports/prediction/decisionMvpProviderProofGate";
import { buildDecisionMvpProviderSetupPacket } from "@/lib/sports/prediction/decisionMvpProviderSetupPacket";
import { buildDecisionProviderEnvDiagnosticFromEnv } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import { buildDecisionProviderUnlockSnapshot } from "@/lib/sports/prediction/decisionProviderUnlockSnapshot";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
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
  const [rows, readiness, liveProviderProbeLedger] = await Promise.all([
    getPredictions({ date: query.date, sport: query.sport }),
    verifyDecisionEngineReadiness(),
    buildDecisionLiveProviderProbeLedger({
      date: query.date,
      sport: query.sport,
      env: process.env,
      runRequested: false,
      adminAuthorized: false
    })
  ]);
  const providerEnvDiagnostic = buildDecisionProviderEnvDiagnosticFromEnv({ date: query.date, sport: query.sport, env: process.env });
  const mvpProgressSnapshot = buildDecisionMvpProgressSnapshot({ date: query.date, sport: query.sport, rows, readiness, providerEnvDiagnostic });
  const providerUnlockSnapshot = buildDecisionProviderUnlockSnapshot({ date: query.date, sport: query.sport, providerEnvDiagnostic, liveProviderProbeLedger });
  const slateThinking = buildDecisionSlateThinking({ rows, date: query.date, sport: query.sport, limit });
  const evidenceQueue = buildDecisionMvpEvidenceAcquisitionQueue({ date: query.date, sport: query.sport, slateThinking, providerUnlockSnapshot, limit });
  const setupPacket = buildDecisionMvpProviderSetupPacket({ date: query.date, sport: query.sport, providerUnlockSnapshot, evidenceQueue });
  const providerProofGate = buildDecisionMvpProviderProofGate({
    date: query.date,
    sport: query.sport,
    setupPacket,
    liveProviderProbeLedger,
    adminTokenConfigured: hasAnyConfiguredEnv(process.env, ["ODDSPADI_ADMIN_TOKEN"])
  });

  return apiSuccess(
    buildDecisionMvpLiveActivationBridge({
      date: query.date,
      sport: query.sport,
      providerEnvDiagnostic,
      liveProviderProbeLedger,
      providerProofGate
    })
  );
}
