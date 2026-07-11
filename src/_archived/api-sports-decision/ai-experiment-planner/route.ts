import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { buildDecisionAIExperimentPlanner } from "@/lib/sports/prediction/decisionAIExperimentPlanner";
import type { DecisionAIThoughtEpisode } from "@/lib/sports/prediction/decisionAIThoughtEpisode";
import { getDecisionAIThoughtMemory } from "@/lib/sports/prediction/decisionAIThoughtMemory";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
}

function parseLimit(url: URL): number {
  const parsed = Number(url.searchParams.get("limit"));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 100) : 24;
}

function decisionUrl(origin: string, path: string, date: string, sport: string, runRequested: boolean): URL {
  const target = new URL(path, origin);
  target.searchParams.set("date", date);
  target.searchParams.set("sport", sport);
  if (runRequested) target.searchParams.set("run", "1");
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
  const thoughtUrl = decisionUrl(url.origin, "/api/sports/decision/ai-thought-episode", query.date, query.sport, runRequested);

  const thought = await fetchData<DecisionAIThoughtEpisode>(thoughtUrl);
  if (!thought) return apiError("Unable to build the AI thought episode before experiment planning.", 502);

  const memory = await getDecisionAIThoughtMemory({ thought, limit: parseLimit(url) });

  return apiSuccess(
    buildDecisionAIExperimentPlanner({
      control: {
        controlHash: thought.identity.controlHash,
        status: thought.chain.controlStatus,
        nextMove: thought.chain.nextMove,
        proofUrls: thought.proofUrls
      },
      thought,
      memory
    })
  );
}
