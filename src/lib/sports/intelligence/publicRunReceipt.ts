import type { ProviderRunLog } from "@/lib/sports/intelligence/types";

/**
 * The safe public shape of a scheduled-run receipt.
 *
 * The cron routes' GET handlers were returning `readLatestProviderRun` whole,
 * which publishes the internal run UUID, the internal provider/job names, and
 * an `errors` array. That array is not hypothetical: on 2026-08-02 the
 * outcome-ledger receipt was publicly serving
 * "odds-prune: canceling statement due to statement timeout" — a database
 * implementation detail, readable by anyone.
 *
 * A visitor checking whether the site is up needs a state and a time. An
 * operator needs the rest, and has the run ledger to read it from.
 */
export type PublicRunReceipt = {
  /** Coarse state only. Internal statuses collapse into these four. */
  status: "operational" | "delayed" | "unavailable" | "never-run";
  /** When this job last finished successfully, if it ever has. */
  lastSuccessAt: string | null;
};

export function toPublicRunReceipt(run: ProviderRunLog | null): PublicRunReceipt {
  if (!run) return { status: "never-run", lastSuccessAt: null };

  const completed = run.status === "completed" || run.status === "empty";
  const lastSuccessAt = completed ? run.finishedAt ?? null : null;

  if (completed) return { status: "operational", lastSuccessAt };
  // "running" and "partial" are progress, not failure; anything else is a
  // fault the visitor should see as degraded without learning why.
  if (run.status === "running" || run.status === "partial") return { status: "delayed", lastSuccessAt };
  return { status: "unavailable", lastSuccessAt };
}
