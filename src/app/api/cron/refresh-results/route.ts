import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized, parseRequestedSports } from "@/lib/sports/intelligence/auth";
import { refreshResults } from "@/lib/sports/intelligence/pipeline";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";
import { toPublicRunReceipt } from "@/lib/sports/intelligence/publicRunReceipt";
import { expireStaleFixtures } from "@/lib/sports/results/staleFixtures";
import { reconcileFixtureLifecycles } from "@/lib/sports/lifecycle/reconcile";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Two steps, in this order, because the order is the safeguard.
 *
 * First re-read days that have already happened, so a match that finished
 * picks up its real status and score. Then expire whatever the provider still
 * has nothing for. Running expiry alone would mark matches abandoned that the
 * provider was perfectly willing to tell us about; running it second means a
 * fixture is only ever written off after one more genuine attempt.
 */
export const GET = withApiHandler(async () => apiSuccess(toPublicRunReceipt(await readLatestProviderRun(["refresh-results"]))));

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const parsed = parseRequestedSports(request);
  if (parsed.error) return apiError(parsed.error);

  const url = new URL(request.url);
  const requestedLookback = Number(url.searchParams.get("lookbackDays") ?? "3");
  const lookbackDays = Number.isInteger(requestedLookback) ? Math.max(1, Math.min(30, requestedLookback)) : 3;
  const commit = url.searchParams.get("commit") !== "false";

  const refresh = await refreshResults({ sports: parsed.sports, lookbackDays });
  const expiry = await expireStaleFixtures({ commit });
  // Last, and reading the same evidence the pages read. Expiry writes the
  // provider-facing status; this records what we actually believe about each
  // fixture, so the two are comparable rather than competing.
  const lifecycle = await reconcileFixtureLifecycles({ commit, lookbackHours: lookbackDays * 24 });

  const failed =
    refresh.run.status === "failed" ||
    refresh.run.status === "unavailable" ||
    expiry.status === "unavailable" ||
    lifecycle.status === "unavailable";
  const partial = refresh.run.status === "partial" || expiry.status === "partial" || lifecycle.errors.length > 0;
  return apiSuccess(
    {
      lookbackDays,
      refresh,
      expiry,
      // The changes array can be thousands of rows; the receipt carries the
      // shape of the run, not the run itself. The audit table has the detail.
      lifecycle: { ...lifecycle, changes: lifecycle.changes.length }
    },
    { status: failed ? 503 : partial ? 207 : 200 }
  );
});
