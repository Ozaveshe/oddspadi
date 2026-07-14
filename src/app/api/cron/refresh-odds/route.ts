import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized, parseRequestedSports } from "@/lib/sports/intelligence/auth";
import { refreshOdds } from "@/lib/sports/intelligence/pipeline";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiHandler(async () => apiSuccess(await readLatestProviderRun(["refresh-odds"])));

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const parsed = parseRequestedSports(request);
  if (parsed.error) return apiError(parsed.error);
  const result = await refreshOdds({ sports: parsed.sports });
  return apiSuccess(result, { status: result.run.status === "failed" || result.run.status === "unavailable" ? 503 : result.run.status === "partial" ? 207 : 200 });
});
