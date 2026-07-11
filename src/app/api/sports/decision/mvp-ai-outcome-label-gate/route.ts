import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionMvpAIOutcomeLabelGate } from "@/lib/sports/prediction/decisionMvpAIOutcomeLabelGate";
import type { DecisionMvpAILearningQuarantine } from "@/lib/sports/prediction/decisionMvpAILearningQuarantine";

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
    const learningQuarantine = await readApiData<DecisionMvpAILearningQuarantine>(
      new URL(`/api/sports/decision/mvp-ai-learning-quarantine?${params.toString()}`, url.origin)
    );
    return apiSuccess(buildDecisionMvpAIOutcomeLabelGate({ learningQuarantine }));
  } catch (error) {
    return apiError(error instanceof Error ? error.message : "Could not build MVP AI outcome label gate.", 502);
  }
}
