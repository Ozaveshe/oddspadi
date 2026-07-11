import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionMvpAICircuitAutopilot } from "@/lib/sports/prediction/decisionMvpAICircuitAutopilot";
import type { DecisionMvpAICircuitState } from "@/lib/sports/prediction/decisionMvpAICircuitState";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";

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
  const params = new URLSearchParams({
    date: query.date,
    sport: query.sport,
    limit: String(limit)
  });
  if (url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true") {
    params.set("run", "1");
  }

  const circuitState = await fetchDecisionApiData<DecisionMvpAICircuitState>(new URL(`/api/sports/decision/mvp-ai-circuit-state?${params.toString()}`, url.origin), {
    timeoutMs: 420000,
    maxAttempts: 1
  });

  if (!circuitState) return apiError("Unable to build MVP AI circuit state before circuit autopilot.", 502);
  return apiSuccess(buildDecisionMvpAICircuitAutopilot({ circuitState }));
}
