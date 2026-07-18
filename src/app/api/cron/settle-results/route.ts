import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";
import { runPublicPickSettlement } from "@/lib/sports/results/settlement";
import { runCommunityTipSettlement } from "@/lib/community/tipSettlement";
import { runConsensusResearchBackfill } from "@/lib/community/consensusResearchBackfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiHandler(async () => apiSuccess(await readLatestProviderRun(["settle-results", "settle-community-tips"])));

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? "250");
  const limit = Number.isInteger(requested) ? Math.max(1, Math.min(1000, requested)) : 250;
  const publicPicks = await runPublicPickSettlement({ limit, persist: true });
  const communityTips = await runCommunityTipSettlement({ limit, persist: true });
  const consensusResearch = await runConsensusResearchBackfill({ limit, persist: true });
  const unavailable = publicPicks.status === "unavailable" || communityTips.status === "unavailable" || consensusResearch.status === "unavailable";
  const partial = publicPicks.status === "partial" || communityTips.status === "partial" || consensusResearch.status === "partial";
  const status = unavailable ? "unavailable" : partial ? "partial" : "completed";
  return apiSuccess({ status, publicPicks, communityTips, consensusResearch }, { status: unavailable ? 503 : partial ? 207 : 200 });
});
