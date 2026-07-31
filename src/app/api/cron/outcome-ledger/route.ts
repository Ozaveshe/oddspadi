import { apiError, apiSuccess, withApiHandler } from "@/app/api/sports/_utils";
import { isCronAuthorized } from "@/lib/sports/intelligence/auth";
import { readLatestProviderRun } from "@/lib/sports/intelligence/repository";
import { OUTCOME_LEDGER_STAGES, runOutcomeLedgerSweep, type OutcomeLedgerStageName } from "@/lib/sports/results/outcomeLedger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export const GET = withApiHandler(async () => apiSuccess(await readLatestProviderRun(["outcome-ledger"])));

/**
 * One SMALL slice per invocation when `stage` is given. Production proved the
 * platform kills this route long before its declared maxDuration, and a killed
 * invocation cannot close its own provider-run row — the 04:42Z and 05:44Z
 * ticks each held the global pipeline lock until the stale-closer reaped
 * them. The scheduled background worker (15-minute budget) sequences the
 * slices; each slice runs to an ~18s deadline and always finishes its
 * bookkeeping. Without `stage`, the full chain runs with a generous deadline —
 * for manual invocations from environments without the cap.
 */
export const POST = withApiHandler(async (request: Request) => {
  if (!isCronAuthorized(request)) return apiError("Cron authorization failed.", 401);
  const url = new URL(request.url);
  const requested = Number(url.searchParams.get("days") ?? "14");
  const days = Number.isInteger(requested) ? Math.max(1, Math.min(60, requested)) : 14;
  const stageParam = url.searchParams.get("stage");
  if (stageParam !== null && !OUTCOME_LEDGER_STAGES.includes(stageParam as OutcomeLedgerStageName)) {
    return apiError(`stage must be one of: ${OUTCOME_LEDGER_STAGES.join(", ")}.`, 400);
  }

  const report = await runOutcomeLedgerSweep(
    stageParam
      ? {
          days,
          persist: true,
          stages: [stageParam as OutcomeLedgerStageName],
          deadlineAt: Date.now() + 18_000,
          settlementBudgetMs: 12_000,
          maxAcquireAttempts: 3,
          retryDelayMs: 4_000,
          retryReserveMs: 8_000
        }
      : { days, persist: true }
  );
  const status = report.status === "unavailable" ? 503 : report.status === "partial" ? 207 : 200;
  return apiSuccess(report, { status });
});
