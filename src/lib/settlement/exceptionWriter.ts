import type { SupabaseClient } from "@supabase/supabase-js";
import { isMissingRelation } from "@/lib/results/migrationState";

/**
 * Persist exceptions the sweeps raise.
 *
 * They were being returned in memory and discarded when the request ended,
 * which meant `op_settlement_exceptions` had no writer at all while the alert
 * reader queried it. That arrangement produces a permanently clean alert
 * dashboard over a pipeline with real problems — the most expensive kind of
 * green light, because it is indistinguishable from a working one.
 *
 * Writes go through the open-row unique index: a repeat sweep touching the same
 * unresolved problem updates `last_seen_at` rather than adding a row. An
 * hourly sweep with no upsert would turn one unresolved conflict into 24 rows a
 * day and make the queue useless precisely when it matters.
 */

export type PendingException = {
  kind: string;
  severity?: "critical" | "warning" | "info";
  fixtureId?: string | null;
  publicationId?: string | null;
  market?: string | null;
  selection?: string | null;
  detail: Record<string, unknown>;
};

export type ExceptionWriteResult = {
  written: number;
  skipped: number;
  status: "written" | "preview" | "not-migrated" | "failed";
  errors: string[];
};

/**
 * Severity when a caller does not state one.
 *
 * A published claim being wrong or unsettleable is critical; a claim that is
 * degraded but honest is a warning. Defaulting everything to critical would
 * train an operator to ignore the level, which is worse than not having one.
 */
const DEFAULT_SEVERITY: Record<string, "critical" | "warning" | "info"> = {
  result_conflict: "critical",
  duplicate_result: "critical",
  provider_correction: "critical",
  missing_participant_identity: "critical",
  ambiguous_retirement: "critical",
  abandoned_fixture: "warning",
  unknown_market: "warning",
  missing_line: "warning",
  close_missing: "warning",
  close_insufficient_sources: "warning",
  close_identity_failure: "warning",
  close_market_unmapped: "warning",
  close_late_data: "warning",
  alias_duplicate: "critical",
  alias_incompatible_settlement: "critical",
  alias_version_conflict: "critical",
  alias_impossible_line: "warning",
  alias_orientation: "warning",
  alias_overround: "info"
};

export async function writeExceptions(
  client: SupabaseClient | null,
  exceptions: PendingException[],
  // No clock parameter: `first_seen_at` and `last_seen_at` are set by the
  // database. A caller-supplied timestamp on an audit trail is a claim about
  // when something happened, not evidence of it.
  { persist = false }: { persist?: boolean } = {}
): Promise<ExceptionWriteResult> {
  if (!exceptions.length) return { written: 0, skipped: 0, status: persist ? "written" : "preview", errors: [] };
  if (!client) {
    return { written: 0, skipped: exceptions.length, status: "failed", errors: ["Storage is not configured."] };
  }
  if (!persist) return { written: 0, skipped: exceptions.length, status: "preview", errors: [] };

  /**
   * One RPC call per exception rather than a bulk upsert.
   *
   * A plain upsert cannot express this: the open-row unique index is partial
   * with nullable key columns, so the conflict target is not inferable — and an
   * upsert setting `first_seen_at` would reset it every sweep, turning "open
   * for three days" into "appeared a minute ago", hourly, forever. The age of
   * an exception is most of its information.
   *
   * Batches here are small by construction. A sweep raising hundreds of
   * exceptions is itself the finding, and it will show up as one.
   */
  let written = 0;
  const errors: string[] = [];
  for (const exception of exceptions) {
    const { error } = await client.rpc("op_record_settlement_exception", {
      p_kind: exception.kind,
      p_severity: exception.severity ?? DEFAULT_SEVERITY[exception.kind] ?? "warning",
      p_detail: exception.detail,
      p_fixture_id: exception.fixtureId ?? null,
      p_publication_id: exception.publicationId ?? null,
      p_market: exception.market ?? null,
      p_selection: exception.selection ?? null
    });
    if (error) {
      if (isMissingRelation(error, "op_settlement_exceptions")) {
        return { written, skipped: exceptions.length - written, status: "not-migrated", errors: [error.message] };
      }
      errors.push(`${exception.kind}: ${error.message}`);
      continue;
    }
    written += 1;
  }

  return {
    written,
    skipped: exceptions.length - written,
    status: errors.length ? "failed" : "written",
    errors
  };
}
