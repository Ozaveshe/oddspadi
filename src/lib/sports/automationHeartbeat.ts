import { getSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Live heartbeat of every scheduled job, for the engine page.
 *
 * The pipeline runs itself — decision cycles, settlement, the outcome ledger,
 * nightly recalibration — but until now the only way to know it was alive was
 * to ask someone with database access. This reads the same run ledger the
 * jobs write (`op_provider_ingestion_runs`) and compares each job's last run
 * against its own schedule, so "is the machine running?" is answerable from
 * the product, per job, with no hands on the wheel.
 */
export type AutomationJobFreshness = "ok" | "late" | "failed" | "none";

export type AutomationJobStatus = {
  id: string;
  label: string;
  cadence: string;
  lastRunAt: string | null;
  lastStatus: string | null;
  minutesSinceRun: number | null;
  freshness: AutomationJobFreshness;
  error: string | null;
};

const HOUR_MS = 60 * 60_000;

/**
 * staleAfterMs is deliberately ~2-3x the schedule interval: one skipped pass
 * (pipeline lock contention, a provider outage) is normal operation and heals
 * on the next run — only a second consecutive miss is worth surfacing.
 */
const JOB_CATALOG: Array<{ id: string; label: string; cadence: string; staleAfterMs: number }> = [
  { id: "run-daily-engine", label: "Decision cycles", cadence: "every 30 minutes", staleAfterMs: 2 * HOUR_MS },
  { id: "refresh-odds", label: "Odds refresh", cadence: "every 30 minutes", staleAfterMs: 2 * HOUR_MS },
  { id: "import-fixtures", label: "Fixture imports", cadence: "every 30 minutes", staleAfterMs: 3 * HOUR_MS },
  { id: "settle-results", label: "Result settlement", cadence: "hourly", staleAfterMs: 3 * HOUR_MS },
  { id: "settle-community-tips", label: "Community tip settlement", cadence: "hourly", staleAfterMs: 3 * HOUR_MS },
  { id: "outcome-ledger", label: "Outcome ledger", cadence: "hourly", staleAfterMs: 3 * HOUR_MS },
  { id: "enrich-fixture-identities", label: "Identity enrichment", cadence: "daily", staleAfterMs: 30 * HOUR_MS },
  { id: "model-learning", label: "Shadow recalibration", cadence: "daily", staleAfterMs: 30 * HOUR_MS }
];

function freshnessOf(status: string | null, startedAt: string | null, staleAfterMs: number, now: number): AutomationJobFreshness {
  if (!startedAt) return "none";
  const started = Date.parse(startedAt);
  if (!Number.isFinite(started)) return "none";
  if (status === "failed" || status === "unavailable") return "failed";
  if (now - started > staleAfterMs) return "late";
  return "ok";
}

export async function readAutomationHeartbeat(): Promise<AutomationJobStatus[] | null> {
  const client = getSupabaseServerClient();
  if (!client) return null;
  const now = Date.now();

  const jobs = await Promise.all(
    JOB_CATALOG.map(async (job) => {
      const { data, error } = await client
        .from("op_provider_ingestion_runs")
        .select("status,started_at,completed_at,finished_at,error_message,metadata")
        .eq("job_type", job.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) {
        return { id: job.id, label: job.label, cadence: job.cadence, lastRunAt: null, lastStatus: null, minutesSinceRun: null, freshness: "none" as const, error: error.message };
      }
      const metadata = (data?.metadata ?? {}) as Record<string, unknown>;
      const status = typeof metadata.pipelineStatus === "string" ? metadata.pipelineStatus : ((data?.status as string | null) ?? null);
      const startedAt = (data?.started_at as string | null) ?? null;
      const started = startedAt ? Date.parse(startedAt) : Number.NaN;
      return {
        id: job.id,
        label: job.label,
        cadence: job.cadence,
        lastRunAt: startedAt,
        lastStatus: status,
        minutesSinceRun: Number.isFinite(started) ? Math.max(0, Math.round((now - started) / 60_000)) : null,
        freshness: freshnessOf(status, startedAt, job.staleAfterMs, now),
        error: (data?.error_message as string | null) ?? null
      };
    })
  );
  // A board with zero recorded runs means the ledger itself is unreadable —
  // render nothing rather than eight identical "no runs" rows.
  return jobs.every((job) => job.freshness === "none") ? null : jobs;
}
