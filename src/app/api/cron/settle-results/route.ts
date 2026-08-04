import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";
import { toPublicRunReceipt } from "@/lib/sports/intelligence/publicRunReceipt";
import { runPublicPickSettlement } from "@/lib/sports/results/settlement";
import { runCommunityTipSettlement } from "@/lib/community/tipSettlement";
import { runConsensusResearchBackfill } from "@/lib/community/consensusResearchBackfill";
import { runPublicationSettlement } from "@/lib/publication/settlePublications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiHandler(async () => apiSuccess(toPublicRunReceipt(await readLatestProviderRun(["settle-results", "settle-community-tips"]))));

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? "250");
  const limit = Number.isInteger(requested) ? Math.max(1, Math.min(1000, requested)) : 250;
  const publicPicks = await runPublicPickSettlement({ limit, persist: true });
  // The published ledger settles here too. `op_settle_publication` shipped with
  // the ledger and had no caller until now, which is why 230 published picks
  // sat unsettled and the public track record showed nothing.
  const publications = await runPublicationSettlement({ limit, persist: true });
  const communityTips = await runCommunityTipSettlement({ limit, persist: true });
  const consensusResearch = await runConsensusResearchBackfill({ limit, persist: true });
  const parts = [publicPicks, publications, communityTips, consensusResearch];
  const unavailable = parts.some((part) => part.status === "unavailable");
  const partial = parts.some((part) => part.status === "partial");
  const status = unavailable ? "unavailable" : partial ? "partial" : "completed";
  return apiSuccess({ status, publicPicks, publications, communityTips, consensusResearch }, { status: unavailable ? 503 : partial ? 207 : 200 });
});
