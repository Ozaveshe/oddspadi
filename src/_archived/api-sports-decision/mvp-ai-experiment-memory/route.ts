import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionMvpAIExperimentMemory } from "@/lib/sports/prediction/decisionMvpAIExperimentMemory";
import { fetchDecisionApiData } from "@/lib/sports/prediction/decisionInternalFetch";
import type { DecisionMvpAIDecisionTurn } from "@/lib/sports/prediction/decisionMvpAIDecisionTurn";
import type { DecisionMvpAIExperimentObserver } from "@/lib/sports/prediction/decisionMvpAIExperimentObserver";

export const dynamic = "force-dynamic";

function shouldObserve(url: URL): boolean {
  return url.searchParams.get("observe") === "1" || url.searchParams.get("observe") === "true";
}

function decisionTurnUrl(origin: string, date: string, sport: string, limit: string | null): URL {
  const target = new URL("/api/sports/decision/mvp-ai-decision-turn", origin);
  target.searchParams.set("date", date);
  target.searchParams.set("sport", sport);
  if (limit) target.searchParams.set("limit", limit);
  return target;
}

function observerUrl(origin: string, date: string, sport: string, limit: string | null, observeRequested: boolean): URL {
  const target = new URL("/api/sports/decision/mvp-ai-experiment-observer", origin);
  target.searchParams.set("date", date);
  target.searchParams.set("sport", sport);
  if (limit) target.searchParams.set("limit", limit);
  if (observeRequested) target.searchParams.set("run", "1");
  return target;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const limit = url.searchParams.get("limit");
  const observeRequested = shouldObserve(url);
  const [decisionTurn, experimentObserver] = await Promise.all([
    fetchDecisionApiData<DecisionMvpAIDecisionTurn>(decisionTurnUrl(url.origin, query.date, query.sport, limit), {
      timeoutMs: 120000,
      maxAttempts: 2
    }),
    fetchDecisionApiData<DecisionMvpAIExperimentObserver>(observerUrl(url.origin, query.date, query.sport, limit, observeRequested), {
      timeoutMs: 120000,
      maxAttempts: 2
    })
  ]);

  if (!decisionTurn) return apiError("Unable to build the MVP AI decision turn before experiment memory.", 502);
  if (!experimentObserver) return apiError("Unable to build the MVP AI experiment observer before experiment memory.", 502);

  return apiSuccess(
    buildDecisionMvpAIExperimentMemory({
      decisionTurn,
      experimentObserver,
      origin: url.origin
    })
  );
}
