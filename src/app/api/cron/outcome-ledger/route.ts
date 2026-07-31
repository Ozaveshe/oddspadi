import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";
import { runOutcomeLedgerSweep } from "@/lib/sports/results/outcomeLedger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiHandler(async () => apiSuccess(await readLatestProviderRun(["outcome-ledger"])));

export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const requested = Number(new URL(request.url).searchParams.get("days") ?? "14");
  const days = Number.isInteger(requested) ? Math.max(1, Math.min(60, requested)) : 14;
  const report = await runOutcomeLedgerSweep({ days, persist: true });
  const status = report.status === "unavailable" ? 503 : report.status === "partial" ? 207 : 200;
  return apiSuccess(report, { status });
});
