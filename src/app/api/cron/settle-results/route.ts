import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";
import { toPublicRunReceipt } from "@/lib/sports/intelligence/publicRunReceipt";
import { runPublicPickSettlement } from "@/lib/sports/results/settlement";
import { runCommunityTipSettlement } from "@/lib/community/tipSettlement";
import { runConsensusResearchBackfill } from "@/lib/community/consensusResearchBackfill";
import { runPublicationSettlement } from "@/lib/publication/settlePublications";
import { runCanonicalPublicationSettlement } from "@/lib/publication/canonicalSettlement";
import { runClosingCapture } from "@/lib/closing/captureSweep";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiHandler(async () => apiSuccess(toPublicRunReceipt(await readLatestProviderRun(["settle-results", "settle-community-tips"]))));

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? "250");
  const limit = Number.isInteger(requested) ? Math.max(1, Math.min(1000, requested)) : 250;
  const publicPicks = await runPublicPickSettlement({ limit, persist: true });

  // Canonical settlement runs first, and precedence follows from that rather
  // than from a flag: it settles what it can from verified canonical results,
  // which sets `settlement_status`, and the legacy pass below only ever queries
  // rows still marked `unsettled`.
  const canonicalPublications = await runCanonicalPublicationSettlement({ limit, persist: true });

  // The transitional pass. It grades from an aggregate final score, so it
  // settles a penalty shootout against the post-shootout result — correct for a
  // match that went the regulation distance and wrong for one that did not.
  // It drains to nothing as op_fixture_results fills, and is removed when it
  // reaches zero candidates for a full cycle.
  //
  // `op_settle_publication` shipped with the ledger and had no caller at all
  // until this route called it, which is why 230 published picks sat unsettled
  // and the public track record showed nothing.
  const publications = await runPublicationSettlement({ limit, persist: true });

  // Closing capture is independent of settlement — a claim's close is a fact
  // about the market before kickoff, not about the result — but it runs here
  // because both are post-kickoff work on the same set of claims, and one cron
  // pass is easier to reason about than two racing on the same rows.
  const closingPrices = await runClosingCapture({ limit, persist: true });

  const communityTips = await runCommunityTipSettlement({ limit, persist: true });
  const consensusResearch = await runConsensusResearchBackfill({ limit, persist: true });
  const parts = [publicPicks, canonicalPublications, publications, closingPrices, communityTips, consensusResearch];
  const unavailable = parts.some((part) => part.status === "unavailable");
  const partial = parts.some((part) => part.status === "partial");
  const status = unavailable ? "unavailable" : partial ? "partial" : "completed";
  return apiSuccess(
    {
      status,
      publicPicks,
      canonicalPublications,
      publications,
      closingPrices: { ...closingPrices, exceptions: closingPrices.exceptions.length },
      communityTips,
      consensusResearch
    },
    { status: unavailable ? 503 : partial ? 207 : 200 }
  );
});
