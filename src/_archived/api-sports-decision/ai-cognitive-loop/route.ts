import { apiError, apiSuccess, parseSportsQuery } from "@/app/api/sports/_utils";
import { isDecisionAdminAuthorized } from "@/_archived/api-sports-decision/_admin";
import { buildDecisionAICognitiveLoop } from "@/lib/sports/prediction/decisionAICognitiveLoop";
import { runDecisionAIReasoningGateway } from "@/lib/sports/prediction/decisionAIReasoningGateway";
import type { DecisionOperatorEpisode } from "@/lib/sports/prediction/decisionOperatorEpisode";

export const dynamic = "force-dynamic";

async function fetchEpisode(url: URL): Promise<DecisionOperatorEpisode | null> {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success || !payload.data) return null;
  return payload.data as DecisionOperatorEpisode;
}

export async function GET(request: Request) {
  const query = parseSportsQuery(request);
  if ("error" in query) return apiError(query.error);

  const url = new URL(request.url);
  const runRequested = url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";
  if (runRequested && !isDecisionAdminAuthorized(request)) {
    return apiError("OpenAI cognitive-loop review requires ODDSPADI_ADMIN_TOKEN and x-oddspadi-admin-token.", 401);
  }
  const observeRequested = runRequested || url.searchParams.get("observe") === "1" || url.searchParams.get("observe") === "true";
  const episodeUrl = new URL("/api/sports/decision/operator-episode", url.origin);
  episodeUrl.searchParams.set("date", query.date);
  episodeUrl.searchParams.set("sport", query.sport);
  if (observeRequested) episodeUrl.searchParams.set("run", "1");

  const episode = await fetchEpisode(episodeUrl);
  if (!episode) return apiError("Unable to build operator episode before AI cognitive loop.", 502);

  const gateway = await runDecisionAIReasoningGateway({ episode, runRequested });
  return apiSuccess(buildDecisionAICognitiveLoop({ episode, gateway }));
}
