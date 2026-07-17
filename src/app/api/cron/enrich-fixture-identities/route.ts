import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { runUpcomingIdentityEnrichment } from "@/lib/sports/intelligence/identityEnrichment";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiHandler(async () => apiSuccess(await readLatestProviderRun(["enrich-fixture-identities"])));

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const outcome = await runUpcomingIdentityEnrichment();
  const unavailable = ["failed", "unavailable"].includes(outcome.run.status);
  return apiSuccess(outcome, {
    status: outcome.success ? 200 : unavailable ? 503 : outcome.skippedOverlap ? 409 : outcome.run.status === "partial" ? 207 : 503
  });
});
