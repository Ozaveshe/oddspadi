import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { readAlertReport } from "@/lib/settlement/alertReader";

export const dynamic = "force-dynamic";

/**
 * Settlement and closing-price alerts, derived at read time.
 *
 * Read-only by construction — there is no POST here and nothing this route can
 * write. The HTTP status carries the same three-way meaning as the CLI's exit
 * code, so a monitor can act on either without parsing the body:
 *
 *   200  clean, or warnings only
 *   409  critical findings
 *   503  could not complete — a source was unreadable
 *
 * 503 rather than 200-with-an-empty-list is the point. A run that could not
 * read its sources has no basis for saying anything is clean.
 */
export const GET = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Unauthorized.", 401);
  const report = await readAlertReport();
  const status = report.exitCode === 2 ? 503 : report.exitCode === 1 ? 409 : 200;
  return apiSuccess(report, { status });
});
