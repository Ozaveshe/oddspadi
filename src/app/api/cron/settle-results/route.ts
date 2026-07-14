import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";
import { runPublicPickSettlement } from "@/lib/sports/results/settlement";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiHandler(async () => apiSuccess(await readLatestProviderRun(["settle-results"])));

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const requested = Number(new URL(request.url).searchParams.get("limit") ?? "250");
  const limit = Number.isInteger(requested) ? Math.max(1, Math.min(1000, requested)) : 250;
  const result = await runPublicPickSettlement({ limit, persist: true });
  return apiSuccess(result, { status: result.status === "unavailable" ? 503 : result.status === "partial" ? 207 : 200 });
});
