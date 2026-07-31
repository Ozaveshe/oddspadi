import { timingSafeEqual } from "node:crypto";
import type { Context } from "@netlify/functions";

declare const Netlify: { env: { get(name: string): string | undefined } };
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type OutcomeLedgerWorkerOptions = {
  siteUrl: string | null;
  adminToken: string | null;
  scheduleToken: string | null;
  days?: string | null;
  fetchImpl?: FetchLike;
  /** Test hook; production uses real waits between lock-busy slices. */
  waitMs?: (ms: number) => Promise<void>;
};

function clean(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function tokenMatches(expected: string, supplied: string): boolean {
  const left = Buffer.from(expected);
  const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

type SliceOutcome = {
  stage: string;
  status: number;
  runStatus: string | null;
  budgetExhausted: boolean;
};

/**
 * Sequences the outcome-ledger chain as SMALL per-stage route calls.
 *
 * The Next route dies at the platform's real execution cap long before its
 * declared maxDuration, and a killed invocation leaves its provider-run row
 * "running" — production ticks at 04:42Z and 05:44Z each held the global
 * pipeline lock for the stale-closer that way. This background function has a
 * 15-minute budget, so the loop lives here: one bounded slice per HTTP call,
 * settlement repeated while it reports an exhausted budget, brief waits when a
 * slice finds the pipeline lock busy.
 */
export async function runOutcomeLedgerWorker({
  siteUrl,
  adminToken,
  scheduleToken,
  days,
  fetchImpl = fetch,
  waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}: OutcomeLedgerWorkerOptions): Promise<Response> {
  const baseUrl = clean(siteUrl);
  const token = clean(adminToken);
  const supplied = clean(scheduleToken);
  if (!baseUrl || !token) return Response.json({ success: false, error: "Outcome ledger worker configuration is incomplete." }, { status: 503 });
  if (!supplied || !tokenMatches(token, supplied)) return Response.json({ success: false, error: "Outcome ledger worker authorization failed." }, { status: 401 });

  const safeDays = clean(days) ?? "14";
  const slices: SliceOutcome[] = [];
  let busyWaits = 0;

  const callStage = async (stage: string): Promise<SliceOutcome> => {
    const endpoint = new URL("/api/cron/outcome-ledger", baseUrl);
    endpoint.searchParams.set("days", safeDays);
    endpoint.searchParams.set("stage", stage);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: { accept: "application/json", "x-oddspadi-admin-token": token },
        signal: AbortSignal.timeout(30_000)
      });
      const body = (await response.json().catch(() => null)) as { data?: { status?: string; stages?: Array<{ stage: string; detail?: { budgetExhausted?: unknown } }> } } | null;
      const runStatus = body?.data?.status ?? null;
      const settlementStage = body?.data?.stages?.find((entry) => entry.stage === "decision-settlement");
      return {
        stage,
        status: response.status,
        runStatus,
        budgetExhausted: settlementStage?.detail?.budgetExhausted === true
      };
    } catch (error) {
      return { stage, status: 504, runStatus: error instanceof Error ? error.message : "request failed", budgetExhausted: false };
    }
  };

  const runStage = async (stage: string): Promise<SliceOutcome> => {
    let outcome = await callStage(stage);
    // "skipped" means the slice never got the pipeline lock; the gaps between
    // pipeline jobs are minutes wide, so short waits are usually enough. The
    // busy-wait budget is shared across the run and bounded well inside the
    // background function's 15 minutes.
    while (outcome.runStatus === "skipped" && busyWaits < 6) {
      busyWaits += 1;
      await waitMs(45_000);
      outcome = await callStage(stage);
    }
    slices.push(outcome);
    return outcome;
  };

  await runStage("closing-odds");
  // Settlement drains a bounded amount per slice; repeat while it reports an
  // exhausted budget. The cap is a backstop far above any real backlog hour.
  for (let slice = 0; slice < 18; slice += 1) {
    const outcome = await runStage("decision-settlement");
    if (!(outcome.status === 200 || outcome.status === 207) || !outcome.budgetExhausted) break;
    await waitMs(1_500);
  }
  await runStage("outcome-backfill");
  await runStage("odds-prune");

  const failures = slices.filter((slice) => !(slice.status === 200 || slice.status === 207 || slice.runStatus === "skipped")).length;
  const success = failures === 0;
  console.info(JSON.stringify({ event: "oddspadi-outcome-ledger-worker", success, slices: slices.length, busyWaits, failures }));
  return Response.json(
    { success, mode: "scheduled-outcome-ledger", days: safeDays, busyWaits, slices },
    { status: success ? 200 : 502 }
  );
}

export default async function outcomeLedgerWorker(request: Request, context: Context): Promise<Response> {
  return runOutcomeLedgerWorker({
    siteUrl: clean(Netlify.env.get("ODDSPADI_SITE_URL")) ?? clean(context.site.url) ?? clean(Netlify.env.get("URL")),
    adminToken: clean(Netlify.env.get("ODDSPADI_ADMIN_TOKEN")),
    scheduleToken: request.headers.get("x-oddspadi-schedule-token"),
    days: clean(Netlify.env.get("ODDSPADI_OUTCOME_LEDGER_DAYS"))
  });
}
