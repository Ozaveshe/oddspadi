import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/app/api/sports/decision/_admin";
import type { DecisionAIControlPacket } from "@/lib/sports/prediction/decisionAIControlPacket";
import { buildDecisionAIThoughtEpisode, persistDecisionAIThoughtEpisode } from "@/lib/sports/prediction/decisionAIThoughtEpisode";
import type { DecisionOperatorEpisode } from "@/lib/sports/prediction/decisionOperatorEpisode";

export const dynamic = "force-dynamic";

function shouldRun(url: URL): boolean {
  return url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
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

async function buildThoughtEpisodeFromRequest(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return { error: query.error };

  const url = new URL(request.url);
  const runRequested = shouldRun(url);
  const [control, episode] = await Promise.all([
    fetchData<DecisionAIControlPacket>(decisionUrl(url.origin, "/api/sports/decision/ai-control", query.date, query.sport, runRequested)),
    fetchData<DecisionOperatorEpisode>(decisionUrl(url.origin, "/api/sports/decision/operator-episode", query.date, query.sport, runRequested))
  ]);

  if (!control || !episode) {
    return { error: "Unable to build the AI thought episode.", status: 502 };
  }

  return {
    control,
    episode,
    thought: buildDecisionAIThoughtEpisode({ control, episode })
  };
}

export async function GET(request: Request) {
  const result = await buildThoughtEpisodeFromRequest(request);
  if ("error" in result) return apiError(result.error ?? "Unable to build the AI thought episode.", result.status ?? 400);
  return apiSuccess(result.thought);
}

export async function POST(request: Request) {
  if (!isDecisionAdminAuthorized(request)) {
    return apiError("AI thought-episode writes require ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }

  const result = await buildThoughtEpisodeFromRequest(request);
  if ("error" in result) return apiError(result.error ?? "Unable to build the AI thought episode.", result.status ?? 400);

  const persistence = await persistDecisionAIThoughtEpisode(result.thought);
  return apiSuccess(
    buildDecisionAIThoughtEpisode({
      control: result.control,
      episode: result.episode,
      persistence
    })
  );
}
