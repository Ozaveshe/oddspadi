import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import type { DecisionMvpAIAnswerComposer } from "@/lib/sports/prediction/decisionMvpAIAnswerComposer";
import type { DecisionMvpAIAnswerReleasePacket } from "@/lib/sports/prediction/decisionMvpAIAnswerReleasePacket";
import type { DecisionMvpAIAnswerVerifier } from "@/lib/sports/prediction/decisionMvpAIAnswerVerifier";
import { buildDecisionMvpAICircuitState } from "@/lib/sports/prediction/decisionMvpAICircuitState";
import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import { buildDecisionMvpAIExperimentMemory } from "@/lib/sports/prediction/decisionMvpAIExperimentMemory";
import { buildDecisionMvpAIExperimentObserver } from "@/lib/sports/prediction/decisionMvpAIExperimentObserver";
import type { DecisionMvpAILearningHandoff } from "@/lib/sports/prediction/decisionMvpAILearningHandoff";
import type { DecisionMvpAILearningQuarantine } from "@/lib/sports/prediction/decisionMvpAILearningQuarantine";
import type { DecisionMvpAILoopReceipt } from "@/lib/sports/prediction/decisionMvpAILoopReceipt";
import type { DecisionMvpAIOutcomeLabelGate } from "@/lib/sports/prediction/decisionMvpAIOutcomeLabelGate";
import type { DecisionMvpAIProofCoordinator } from "@/lib/sports/prediction/decisionMvpAIProofCoordinator";
import type { DecisionMvpAIPromotionFirewall } from "@/lib/sports/prediction/decisionMvpAIPromotionFirewall";
import type { DecisionMvpAIPublicAnswerGate } from "@/lib/sports/prediction/decisionMvpAIPublicAnswerGate";
import type { DecisionMvpAIReleaseAuditTrail } from "@/lib/sports/prediction/decisionMvpAIReleaseAuditTrail";
import type { DecisionMvpAIReviewPacket } from "@/lib/sports/prediction/decisionMvpAIReviewPacket";
import type { DecisionMvpAIReviewRunner } from "@/lib/sports/prediction/decisionMvpAIReviewRunner";
import type { DecisionMvpAIShadowCalibrationBridge } from "@/lib/sports/prediction/decisionMvpAIShadowCalibrationBridge";
import type { DecisionProviderEnvDiagnostic } from "@/lib/sports/prediction/decisionProviderEnvDiagnostic";
import type { DecisionMvpProviderProofGate } from "@/lib/sports/prediction/decisionMvpProviderProofGate";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readApiData<T>(url: URL): Promise<T> {
  let lastError = `Request failed for ${url.pathname}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 120000);
      const response = await fetch(url, { cache: "no-store", signal: controller.signal });
      const payload = (await response.json().catch(() => null)) as { success?: boolean; data?: T; error?: string } | null;
      if (response.ok && payload?.success && payload.data) return payload.data;
      lastError = payload?.error ?? `Request failed for ${url.pathname}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : `Request failed for ${url.pathname}`;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
    if (attempt < 2) await delay(350);
  }
  throw new Error(lastError);
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const limit = parseLimit(url.searchParams.get("limit"));
  const params = new URLSearchParams({
    date: query.date,
    sport: query.sport,
    limit: String(limit)
  });
  if (url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true") {
    params.set("run", "1");
  }

  try {
    const route = (path: string) => new URL(`/api/sports/decision/${path}?${params.toString()}`, url.origin);
    const reviewPacket = await readApiData<DecisionMvpAIReviewPacket>(route("mvp-ai-review-packet"));
    const reviewRunner = await readApiData<DecisionMvpAIReviewRunner>(route("mvp-ai-review-runner"));
    const providerEnvDiagnostic = await readApiData<DecisionProviderEnvDiagnostic>(route("provider-env-diagnostic"));
    const providerProofGate = await readApiData<DecisionMvpProviderProofGate>(route("mvp-provider-proof-gate"));
    const critiqueLedger = await readApiData<DecisionMvpAICritiqueLedger>(route("mvp-ai-critique-ledger"));
    const proofCoordinator = await readApiData<DecisionMvpAIProofCoordinator>(route("mvp-ai-proof-coordinator"));
    const decisionTurn = await readApiData<DecisionMvpAIDecisionTurn>(route("mvp-ai-decision-turn"));
    const loopReceipt = await readApiData<DecisionMvpAILoopReceipt>(route("mvp-ai-loop-receipt"));
    const publicAnswerGate = await readApiData<DecisionMvpAIPublicAnswerGate>(route("mvp-ai-public-answer-gate"));
    const answerComposer = await readApiData<DecisionMvpAIAnswerComposer>(route("mvp-ai-answer-composer"));
    const answerVerifier = await readApiData<DecisionMvpAIAnswerVerifier>(route("mvp-ai-answer-verifier"));
    const releasePacket = await readApiData<DecisionMvpAIAnswerReleasePacket>(route("mvp-ai-answer-release-packet"));
    const auditTrail = await readApiData<DecisionMvpAIReleaseAuditTrail>(route("mvp-ai-release-audit-trail"));
    const learningHandoff = await readApiData<DecisionMvpAILearningHandoff>(route("mvp-ai-learning-handoff"));
    const learningQuarantine = await readApiData<DecisionMvpAILearningQuarantine>(route("mvp-ai-learning-quarantine"));
    const outcomeLabelGate = await readApiData<DecisionMvpAIOutcomeLabelGate>(route("mvp-ai-outcome-label-gate"));
    const shadowCalibrationBridge = await readApiData<DecisionMvpAIShadowCalibrationBridge>(route("mvp-ai-shadow-calibration-bridge"));
    const promotionFirewall = await readApiData<DecisionMvpAIPromotionFirewall>(route("mvp-ai-promotion-firewall"));
    const experimentObserver = buildDecisionMvpAIExperimentObserver({
      decisionTurn,
      origin: url.origin
    });
    const experimentMemory = buildDecisionMvpAIExperimentMemory({
      decisionTurn,
      experimentObserver,
      origin: url.origin
    });

    return apiSuccess(
      buildDecisionMvpAICircuitState({
        reviewPacket,
        reviewRunner,
        providerEnvDiagnostic,
        providerProofGate,
        critiqueLedger,
        proofCoordinator,
        decisionTurn,
        experimentObserver,
        experimentMemory,
        loopReceipt,
        publicAnswerGate,
        answerComposer,
        answerVerifier,
        releasePacket,
        auditTrail,
        learningHandoff,
        learningQuarantine,
        outcomeLabelGate,
        shadowCalibrationBridge,
        promotionFirewall
      })
    );
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not build MVP AI circuit state.", 502);
  }
}
