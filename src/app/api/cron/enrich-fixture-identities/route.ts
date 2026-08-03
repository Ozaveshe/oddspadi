import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { readUpcomingIdentityCoverage } from "@/lib/sports/intelligence/identityCoverage";
import { runUpcomingIdentityEnrichment } from "@/lib/sports/intelligence/identityEnrichment";
import { fillTeamLogosFromSiblings } from "@/lib/sports/intelligence/teamCrestFill";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";
import { toPublicRunReceipt } from "@/lib/sports/intelligence/publicRunReceipt";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiHandler(async (request: Request) => {
  if (new URL(request.url).searchParams.get("view") === "coverage") {
    return apiSuccess(await readUpcomingIdentityCoverage());
  }
  return apiSuccess(toPublicRunReceipt(await readLatestProviderRun(["enrich-fixture-identities"])));
});

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const outcome = await runUpcomingIdentityEnrichment();
  // Then borrow crests for clubs the providers cannot supply one for.
  // Enrichment fetches from the provider that owns the team, and two of ours
  // ship no imagery at all — the-odds-api carries none, and api-tennis serves
  // players, who have no badge. For football and basketball we frequently hold
  // the identical club under api-football/api-basketball with a crest, so this
  // is a join rather than a fetch. It runs after enrichment so a genuine
  // provider crest always wins over a borrowed one.
  const borrowedCrests = await fillTeamLogosFromSiblings();
  const unavailable = ["failed", "unavailable"].includes(outcome.run.status);
  return apiSuccess(
    { ...outcome, borrowedCrests },
    { status: outcome.success ? 200 : unavailable ? 503 : outcome.skippedOverlap ? 409 : outcome.run.status === "partial" ? 207 : 503 }
  );
});
