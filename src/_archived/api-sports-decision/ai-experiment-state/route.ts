import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import type { DecisionAIExperimentObserver } from "@/lib/sports/prediction/decisionAIExperimentObserver";
import { buildDecisionAIExperimentState } from "@/lib/sports/prediction/decisionAIExperimentState";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
}

function decisionUrl(origin: string, path: string, date: string, sport: string, runRequested = false, limit: string | null = null): URL {
  const target = new URL(path, origin);
  target.searchParams.set("date", date);
  target.searchParams.set("sport", sport);
  if (runRequested) target.searchParams.set("run", "1");
  if (limit) target.searchParams.set("limit", limit);
  return target;
}

async function fetchData<T>(url: URL): Promise<T | null> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.success && payload.data) return payload.data as T;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return null;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  const limit = url.searchParams.get("limit");
  const observerUrl = decisionUrl(url.origin, "/api/sports/decision/ai-experiment-observer", query.date, query.sport, runRequested, limit);

  const observer = await fetchData<DecisionAIExperimentObserver>(observerUrl);
  if (!observer) return apiError("Unable to build the AI experiment observer before state reduction.", 502);

  return apiSuccess(
    buildDecisionAIExperimentState({
      planner: {
        date: observer.date,
        sport: observer.sport,
        plannerHash: observer.plannerHash,
        selectedExperiment: observer.selectedExperiment,
        proofUrls: observer.proofUrls
      },
      observer
    })
  );
}
