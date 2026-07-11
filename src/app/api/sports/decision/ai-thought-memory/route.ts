import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
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

async function fetchThoughtEpisode(url: URL, date: string, sport: string): Promise<DecisionAIThoughtEpisode | null> {
  const target = new URL("/api/sports/decision/ai-thought-episode", url.origin);
  target.searchParams.set("date", date);
  target.searchParams.set("sport", sport);
  if (shouldRun(url)) target.searchParams.set("run", "1");

  const response = await fetch(target, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload.data) return null;
  return payload.data as DecisionAIThoughtEpisode;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const thought = await fetchThoughtEpisode(url, query.date, query.sport);
  if (!thought) return apiError("Unable to build the current AI thought episode before memory recall.", 502);

  const memory = await getDecisionAIThoughtMemory({
    thought,
    limit: parseLimit(url)
  });

  return apiSuccess(memory);
}
