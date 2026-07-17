import { getSupabaseServerClient } from "@/lib/supabase/server";
import {
  attachBasketballHistoricalOdds,
  type BasketballOddsAttachmentRequest,
  type BasketballOddsAttachmentResult
} from "./basketballOddsAttachment";

type EnvMap = Record<string, string | undefined>;
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export type BasketballOddsBackfillRequest = {
  from: string;
  to: string;
  run?: boolean;
  dryRun?: boolean;
  intervalDays?: number;
  maxJobs?: number;
  maxCredits?: number;
  regions?: string;
  bookmakers?: string;
  limit?: number;
  isClosing?: boolean;
  stopOnError?: boolean;
};

export type BasketballOddsBackfillJob = {
  date: string;
  estimatedCredits: number;
  status: "pending" | "already-completed";
};

export type BasketballOddsBackfillResult = {
  status: "planned" | "dry-run" | "stored" | "partial" | "invalid-request" | "failed";
  runRequested: boolean;
  dryRun: boolean;
  range: { from: string; to: string; intervalDays: number };
  quotaGuard: {
    estimatedCreditsPerJob: number;
    maxCredits: number;
    estimatedCreditsPlanned: number;
    observedCreditsUsed: number;
  };
  candidateJobs: number;
  skippedCompletedJobs: number;
  plannedJobs: number;
  executedJobs: number;
  storedJobs: number;
  dryRunJobs: number;
  noMatchJobs: number;
  failedJobs: number;
  nextCursor: string | null;
  truncated: boolean;
  warnings: string[];
  errors: string[];
  jobs: BasketballOddsBackfillJob[];
  results: Array<{ date: string; result: BasketballOddsAttachmentResult }>;
};

type AttachImpl = (args: {
  request: BasketballOddsAttachmentRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
}) => Promise<BasketballOddsAttachmentResult>;

const DAY_MS = 24 * 60 * 60 * 1000;

function boundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function normalizedSnapshot(value: string): Date | null {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate(), 12));
}

function requestedDates(from: string, to: string, intervalDays: number): string[] {
  const left = normalizedSnapshot(from);
  const right = normalizedSnapshot(to);
  if (!left || !right) return [];
  const start = left <= right ? left : right;
  const end = left <= right ? right : left;
  const dates: string[] = [];
  for (let cursor = start.getTime(); cursor <= end.getTime(); cursor += intervalDays * DAY_MS) {
    dates.push(new Date(cursor).toISOString().replace(".000Z", "Z"));
  }
  return dates;
}

function regionCount(regions: string | undefined): number {
  const values = (regions?.trim() || "us").split(",").map((value) => value.trim()).filter(Boolean);
  return Math.max(1, new Set(values).size);
}

function metadataDate(value: unknown): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const date = (value as Record<string, unknown>).date;
  return typeof date === "string" && Number.isFinite(Date.parse(date))
    ? new Date(date).toISOString().replace(".000Z", "Z")
    : null;
}

async function readCompletedDates(): Promise<{ dates: Set<string>; warning?: string }> {
  const client = getSupabaseServerClient();
  if (!client) return { dates: new Set(), warning: "Completed-date receipts could not be read because Supabase server access is unavailable." };
  const { data, error } = await client
    .from("op_provider_ingestion_runs")
    .select("metadata")
    .eq("sport", "basketball")
    .eq("ingestion_type", "historical_basketball_odds_attachment")
    .eq("status", "completed")
    .order("started_at", { ascending: false })
    .limit(1_000);
  if (error) return { dates: new Set(), warning: `Completed-date receipts could not be read: ${error.message}` };
  return { dates: new Set((data ?? []).flatMap((row) => metadataDate(row.metadata) ?? [])) };
}

export async function runBasketballOddsBackfill({
  request,
  env = process.env,
  fetchImpl = fetch,
  attachImpl = attachBasketballHistoricalOdds,
  completedDates
}: {
  request: BasketballOddsBackfillRequest;
  env?: EnvMap;
  fetchImpl?: FetchLike;
  attachImpl?: AttachImpl;
  completedDates?: Set<string>;
}): Promise<BasketballOddsBackfillResult> {
  const intervalDays = boundedInteger(request.intervalDays, 1, 1, 31);
  const maxJobs = boundedInteger(request.maxJobs, 7, 1, 31);
  const maxCredits = boundedInteger(request.maxCredits, 70, 10, 310);
  const creditsPerJob = 10 * regionCount(request.regions);
  const creditJobCap = Math.floor(maxCredits / creditsPerJob);
  const dates = requestedDates(request.from, request.to, intervalDays);
  const warnings: string[] = [];
  const errors: string[] = [];
  const runRequested = request.run === true;
  const dryRun = request.dryRun ?? true;

  if (!dates.length) errors.push("from and to must be valid ISO dates.");
  if (creditJobCap < 1) errors.push("maxCredits is lower than the estimated cost of one historical odds request.");

  const receiptRead = completedDates ? { dates: completedDates } : await readCompletedDates();
  if (receiptRead.warning) warnings.push(receiptRead.warning);
  const jobs = dates.map((date) => ({
    date,
    estimatedCredits: creditsPerJob,
    status: receiptRead.dates.has(date) ? "already-completed" as const : "pending" as const
  }));
  const pending = jobs.filter((job) => job.status === "pending");
  const planned = errors.length ? [] : pending.slice(0, Math.min(maxJobs, creditJobCap));
  const truncated = pending.length > planned.length;
  if (truncated) warnings.push("Backfill was checkpointed at the configured job or credit ceiling; continue from nextCursor in a later run.");
  if (!runRequested) warnings.push("Plan-only mode made no provider requests and wrote no database rows. Set run=1 to execute the bounded checkpoint.");

  const results: BasketballOddsBackfillResult["results"] = [];
  let storedJobs = 0;
  let dryRunJobs = 0;
  let noMatchJobs = 0;
  let failedJobs = 0;
  let observedCreditsUsed = 0;

  if (runRequested) {
    for (const job of planned) {
      const result = await attachImpl({
        request: {
          date: job.date,
          dryRun,
          regions: request.regions,
          bookmakers: request.bookmakers,
          limit: request.limit,
          isClosing: request.isClosing
        },
        env,
        fetchImpl
      });
      results.push({ date: job.date, result });
      observedCreditsUsed += result.quota.requestCost ?? job.estimatedCredits;
      if (result.status === "stored") storedJobs += 1;
      else if (result.status === "dry-run") dryRunJobs += 1;
      else if (result.status === "no-matches") noMatchJobs += 1;
      else {
        failedJobs += 1;
        errors.push(`${job.date}: ${result.reason ?? result.status}`);
        if (request.stopOnError ?? true) break;
      }
    }
  }

  const executedJobs = results.length;
  const completedThisRun = new Set(
    results
      .filter(({ result }) => result.status === "stored" || result.status === "dry-run" || result.status === "no-matches")
      .map(({ date }) => date)
  );
  const firstUnfinished = pending.find((job) => !completedThisRun.has(job.date));
  const status: BasketballOddsBackfillResult["status"] = errors.length && !executedJobs
    ? "invalid-request"
    : !runRequested
      ? "planned"
      : failedJobs && (storedJobs || dryRunJobs || noMatchJobs)
        ? "partial"
        : failedJobs
          ? "failed"
          : storedJobs || (noMatchJobs && !dryRun)
            ? "stored"
            : "dry-run";

  return {
    status,
    runRequested,
    dryRun,
    range: { from: request.from, to: request.to, intervalDays },
    quotaGuard: {
      estimatedCreditsPerJob: creditsPerJob,
      maxCredits,
      estimatedCreditsPlanned: planned.length * creditsPerJob,
      observedCreditsUsed
    },
    candidateJobs: dates.length,
    skippedCompletedJobs: jobs.filter((job) => job.status === "already-completed").length,
    plannedJobs: planned.length,
    executedJobs,
    storedJobs,
    dryRunJobs,
    noMatchJobs,
    failedJobs,
    nextCursor: firstUnfinished?.date ?? null,
    truncated,
    warnings,
    errors,
    jobs,
    results
  };
}
