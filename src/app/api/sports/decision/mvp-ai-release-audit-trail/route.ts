import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpAIAnswerComposer } from "@/lib/sports/prediction/decisionMvpAIAnswerComposer";
import type { DecisionMvpAIAnswerReleasePacket } from "@/lib/sports/prediction/decisionMvpAIAnswerReleasePacket";
import type { DecisionMvpAIAnswerVerifier } from "@/lib/sports/prediction/decisionMvpAIAnswerVerifier";
import { buildDecisionMvpAIReleaseAuditTrail } from "@/lib/sports/prediction/decisionMvpAIReleaseAuditTrail";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import type { DecisionMvpAILoopReceipt } from "@/lib/sports/prediction/decisionMvpAILoopReceipt";
import type { DecisionMvpAIPublicAnswerGate } from "@/lib/sports/prediction/decisionMvpAIPublicAnswerGate";
import type { DecisionMvpAIProofCoordinator } from "@/lib/sports/prediction/decisionMvpAIProofCoordinator";

export const dynamic = "force-dynamic";

function parseLimit(value: string | null): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return 8;
  return Math.min(parsed, 20);
}

async function readApiData<T>(url: URL): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = (await response.json()) as { success?: boolean; data?: T; error?: string };
  if (!response.ok || !payload.success || !payload.data) {
    throw new Error(payload.error ?? `Request failed for ${url.pathname}`);
  }
  return payload.data;
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
    const urls = {
      critiqueLedger: new URL(`/api/sports/decision/mvp-ai-critique-ledger?${params.toString()}`, url.origin),
      proofCoordinator: new URL(`/api/sports/decision/mvp-ai-proof-coordinator?${params.toString()}`, url.origin),
      decisionTurn: new URL(`/api/sports/decision/mvp-ai-decision-turn?${params.toString()}`, url.origin),
      loopReceipt: new URL(`/api/sports/decision/mvp-ai-loop-receipt?${params.toString()}`, url.origin),
      publicAnswerGate: new URL(`/api/sports/decision/mvp-ai-public-answer-gate?${params.toString()}`, url.origin),
      answerComposer: new URL(`/api/sports/decision/mvp-ai-answer-composer?${params.toString()}`, url.origin),
      answerVerifier: new URL(`/api/sports/decision/mvp-ai-answer-verifier?${params.toString()}`, url.origin),
      releasePacket: new URL(`/api/sports/decision/mvp-ai-answer-release-packet?${params.toString()}`, url.origin)
    };
    const [
      critiqueLedger,
      proofCoordinator,
      decisionTurn,
      loopReceipt,
      publicAnswerGate,
      answerComposer,
      answerVerifier,
      releasePacket
    ] = await Promise.all([
      readApiData<DecisionMvpAICritiqueLedger>(urls.critiqueLedger),
      readApiData<DecisionMvpAIProofCoordinator>(urls.proofCoordinator),
      readApiData<DecisionMvpAIDecisionTurn>(urls.decisionTurn),
      readApiData<DecisionMvpAILoopReceipt>(urls.loopReceipt),
      readApiData<DecisionMvpAIPublicAnswerGate>(urls.publicAnswerGate),
      readApiData<DecisionMvpAIAnswerComposer>(urls.answerComposer),
      readApiData<DecisionMvpAIAnswerVerifier>(urls.answerVerifier),
      readApiData<DecisionMvpAIAnswerReleasePacket>(urls.releasePacket)
    ]);

    return apiSuccess(
      buildDecisionMvpAIReleaseAuditTrail({
        critiqueLedger,
        proofCoordinator,
        decisionTurn,
        loopReceipt,
        publicAnswerGate,
        answerComposer,
        answerVerifier,
        releasePacket
      })
    );
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not build MVP AI release audit trail.", 502);
  }
}
