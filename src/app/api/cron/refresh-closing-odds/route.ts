import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { refreshOdds } from "@/lib/sports/intelligence/pipeline";
import { planClosingWindowRefresh } from "@/lib/closing/closingWindowRefresh";
import type { Sport } from "@/lib/sports/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Poll odds for fixtures about to kick off with a claim riding on them.
 *
 * The general odds refresh runs on a slate-wide cadence, which measured out at
 * one bookmaker for 84.7% of selections in the 90 minutes before kickoff and
 * three or more for 1.6%. Six hours out it is 31.6%. The books are quoting;
 * the sweep is simply elsewhere when the close happens.
 *
 * So this is deliberately narrow rather than a faster version of the general
 * sweep: only fixtures inside the refresh lead, only those carrying a published
 * claim, capped per run. A close matters exactly where a claim will be measured
 * against it, and nowhere else.
 *
 * GET returns the plan without spending any quota, which is the honest way to
 * answer "what would this cost" before scheduling it more aggressively.
 */
export const GET = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Unauthorized.", 401);
  const plan = await planClosingWindowRefresh();
  return apiSuccess(plan, { status: plan.status === "unavailable" ? 503 : 200 });
});

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);

  const plan = await planClosingWindowRefresh();
  if (plan.status === "unavailable") return apiSuccess(plan, { status: 503 });
  // Nothing approaching kickoff is the common case and is not a failure. It
  // also spends no quota, which is the point of planning before polling.
  if (plan.status === "empty") return apiSuccess({ plan, refreshed: null });

  // Only the sports actually represented in the plan. Refreshing all three
  // when the plan holds two football fixtures spends a third of the quota on
  // nothing.
  const sports = [...new Set(plan.targets.map((target) => target.sport))].filter(
    (sport): sport is Sport => sport === "football" || sport === "basketball" || sport === "tennis"
  );

  const refreshed = await refreshOdds({ sports });
  const failed = refreshed.run.status === "failed" || refreshed.run.status === "unavailable";
  return apiSuccess(
    { plan, refreshed },
    { status: failed ? 503 : refreshed.run.status === "partial" ? 207 : 200 }
  );
});
