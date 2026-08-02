import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { runPublicResultsBackfill } from "@/lib/sports/results/backfill";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Unlike the other cron GETs this is not a status receipt — it dry-runs the
 * whole backfill and returns what it would write. Operator-only.
 */
export const GET = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Unauthorized.", 401);
  return apiSuccess(await runPublicResultsBackfill({ execute: false }));
});

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const result = await runPublicResultsBackfill({ execute: true });
  return apiSuccess(result, { status: result.status === "unavailable" ? 503 : result.status === "partial" ? 207 : 200 });
});
