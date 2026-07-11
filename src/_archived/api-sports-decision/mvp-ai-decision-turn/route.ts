import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { hasAnyConfiguredEnv } from "@/lib/env";
import { buildDecisionAIReviewReadiness } from "@/lib/sports/prediction/decisionAIReviewReadiness";
import { buildDecisionLiveProviderProbeLedger } from "@/lib/sports/prediction/decisionLiveProviderProbeLedger";
import { buildDecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import { buildDecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import { buildDecisionMvpAIProofCoordinator } from "@/lib/sports/prediction/decisionMvpAIProofCoordinator";
import { buildDecisionMvpAIReviewPacket } from "@/lib/sports/prediction/decisionMvpAIReviewPacket";
import { runDecisionMvpAIReview } from "@/lib/sports/prediction/decisionMvpAIReviewRunner";
import { buildDecisionMvpAnswerAuthorityGate } from "@/lib/sports/prediction/decisionMvpAnswerAuthorityGate";
import { buildDecisionMvpBeliefRevisionLoop } from "@/lib/sports/prediction/decisionMvpBeliefRevisionLoop";
import { buildDecisionMvpCognitiveCycle } from "@/lib/sports/prediction/decisionMvpCognitiveCycle";
import { buildDecisionMvpEvidenceAcquisitionQueue } from "@/lib/sports/prediction/decisionMvpEvidenceAcquisitionQueue";
import { buildDecisionMvpEvidenceImpactMatrix } from "@/lib/sports/prediction/decisionMvpEvidenceImpactMatrix";
import { buildDecisionMvpLiveActivationBridge } from "@/lib/sports/prediction/decisionMvpLiveActivationBridge";
import { buildDecisionMvpProgressSnapshot } from "@/lib/sports/prediction/decisionMvpProgressSnapshot";
import { buildDecisionMvpProviderActivationChecklist } from "@/lib/sports/prediction/decisionMvpProviderActivationChecklist";
import { buildDecisionMvpProviderProofGate } from "@/lib/sports/prediction/decisionMvpProviderProofGate";
import { buildDecisionMvpProviderProofReceipt } from "@/lib/sports/prediction/decisionMvpProviderProofReceipt";
import { buildDecisionMvpProviderSetupPacket } from "@/lib/sports/prediction/decisionMvpProviderSetupPacket";
import { buildDecisionMvpReasoningCheckpoint } from "@/lib/sports/prediction/decisionMvpReasoningCheckpoint";
import { buildDecisionMvpStorageCorpusGate } from "@/lib/sports/prediction/decisionMvpStorageCorpusGate";
import { buildDecisionOpenAIKeyDiagnostic } from "@/lib/sports/prediction/decisionOpenAIKeyDiagnostic";
import { buildDecisionProviderEnvDiagnosticFromEnv } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import { buildDecisionProviderUnlockSnapshot } from "@/lib/sports/prediction/decisionProviderUnlockSnapshot";
import { verifyDecisionEngineReadiness } from "@/lib/sports/prediction/decisionReadiness";
import { buildDecisionSlateThinking } from "@/lib/sports/prediction/decisionSlateThinking";
import { getPredictions } from "@/lib/sports/service";
import { buildMultiSportCorpusPlan } from "@/lib/sports/training/multiSportCorpusPlan";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI MVP review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
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
  const slateThinking = buildDecisionSlateThinking({ rows, date: query.date, sport: query.sport, limit: Math.max(8, limit) });
  const evidenceQueue = buildDecisionMvpEvidenceAcquisitionQueue({ date: query.date, sport: query.sport, slateThinking, providerUnlockSnapshot, limit });
  const setupPacket = buildDecisionMvpProviderSetupPacket({ date: query.date, sport: query.sport, providerUnlockSnapshot, evidenceQueue });
  const providerProofGate = buildDecisionMvpProviderProofGate({
    date: query.date,
    sport: query.sport,
    setupPacket,
    liveProviderProbeLedger,
    adminTokenConfigured: hasAnyConfiguredEnv(process.env, ["ODDSPADI_ADMIN_TOKEN"])
  });
  const corpusPlan = buildMultiSportCorpusPlan({ env: process.env, baseUrl: url.origin, seasonFrom: 2016, seasonTo: 2025, maxJobsPerLeague: 1 });
  const storageCorpusGate = buildDecisionMvpStorageCorpusGate({
    date: query.date,
    sport: query.sport,
    mvpProgressSnapshot,
    providerProofGate,
    corpusPlan
  });
  const aiReviewReadiness = buildDecisionAIReviewReadiness({ date: query.date, sport: query.sport, env: process.env, baseUrl: url.origin });
  const answerAuthorityGate = buildDecisionMvpAnswerAuthorityGate({
    date: query.date,
    sport: query.sport,
    rows,
    mvpProgressSnapshot,
    providerProofGate,
    storageCorpusGate,
    evidenceQueue,
    aiReviewReadiness
  });
  const providerActivationChecklist = buildDecisionMvpProviderActivationChecklist({
    date: query.date,
    sport: query.sport,
    setupPacket,
    providerProofGate,
    storageCorpusGate,
    answerAuthorityGate
  });
  const providerProofReceipt = buildDecisionMvpProviderProofReceipt({
    date: query.date,
    sport: query.sport,
    providerProofGate,
    liveProviderProbeLedger,
    providerActivationChecklist,
    storageCorpusGate,
    answerAuthorityGate
  });
  const liveActivationBridge = buildDecisionMvpLiveActivationBridge({
    date: query.date,
    sport: query.sport,
    providerEnvDiagnostic,
    liveProviderProbeLedger,
    providerProofGate
  });
  const reasoningCheckpoint = buildDecisionMvpReasoningCheckpoint({
    date: query.date,
    sport: query.sport,
    slateThinking,
    evidenceQueue,
    liveActivationBridge,
    providerProofReceipt,
    answerAuthorityGate,
    mvpProgressSnapshot
  });
  const beliefRevisionLoop = buildDecisionMvpBeliefRevisionLoop({
    date: query.date,
    sport: query.sport,
    reasoningCheckpoint,
    liveActivationBridge,
    providerProofReceipt,
    answerAuthorityGate,
    mvpProgressSnapshot
  });
  const evidenceImpactMatrix = buildDecisionMvpEvidenceImpactMatrix({
    date: query.date,
    sport: query.sport,
    evidenceQueue,
    beliefRevisionLoop,
    mvpProgressSnapshot,
    limit
  });
  const cognitiveCycle = buildDecisionMvpCognitiveCycle({
    date: query.date,
    sport: query.sport,
    reasoningCheckpoint,
    beliefRevisionLoop,
    evidenceImpactMatrix,
    liveActivationBridge,
    providerProofReceipt,
    mvpProgressSnapshot
  });
  const openAiKeyDiagnostic = buildDecisionOpenAIKeyDiagnostic({
    aiReviewReadiness,
    env: process.env
  });
  const packet = buildDecisionMvpAIReviewPacket({
    date: query.date,
    sport: query.sport,
    cognitiveCycle,
    aiReviewReadiness,
    openAiKeyDiagnostic
  });
  const runner = await runDecisionMvpAIReview({
    packet,
    runRequested,
    apiKey: process.env.OPENAI_API_KEY
  });
  const critiqueLedger = buildDecisionMvpAICritiqueLedger({ packet, runner });
  const proofCoordinator = buildDecisionMvpAIProofCoordinator({ cognitiveCycle, evidenceImpactMatrix, critiqueLedger });

  return apiSuccess(buildDecisionMvpAIDecisionTurn({ cognitiveCycle, evidenceImpactMatrix, critiqueLedger, proofCoordinator }));
}
