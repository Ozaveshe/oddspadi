import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import type { DecisionMvpAICritiqueLedger } from "@/lib/sports/prediction/decisionMvpAICritiqueLedger";
import type { DecisionMvpAIAnswerReleasePacket } from "@/lib/sports/prediction/decisionMvpAIAnswerReleasePacket";
import type { DecisionMvpAIReleaseAuditTrail } from "@/lib/sports/prediction/decisionMvpAIReleaseAuditTrail";
import { buildDecisionMvpAILearningHandoff } from "@/lib/sports/prediction/decisionMvpAILearningHandoff";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";

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
    const [critiqueLedger, decisionTurn, releasePacket, auditTrail] = await Promise.all([
      readApiData<DecisionMvpAICritiqueLedger>(new URL(`/api/sports/decision/mvp-ai-critique-ledger?${params.toString()}`, url.origin)),
      readApiData<DecisionMvpAIDecisionTurn>(new URL(`/api/sports/decision/mvp-ai-decision-turn?${params.toString()}`, url.origin)),
      readApiData<DecisionMvpAIAnswerReleasePacket>(new URL(`/api/sports/decision/mvp-ai-answer-release-packet?${params.toString()}`, url.origin)),
      readApiData<DecisionMvpAIReleaseAuditTrail>(new URL(`/api/sports/decision/mvp-ai-release-audit-trail?${params.toString()}`, url.origin))
    ]);

    return apiSuccess(buildDecisionMvpAILearningHandoff({ critiqueLedger, decisionTurn, releasePacket, auditTrail }));
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not build MVP AI learning handoff.", 502);
  }
}
