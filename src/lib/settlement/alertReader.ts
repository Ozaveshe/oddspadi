import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { buildAlertReport, SLA, type AlertInputs, type AlertReport, type UnreadableSource } from "@/lib/settlement/alerts";

/**
 * Read the alert inputs from storage.
 *
 * Every read is independently guarded, and a failed read becomes a
 * `couldNotCheck` entry rather than a zero. That is the whole discipline here:
 * a read that throws must never look like a read that found nothing, because
 * the two produce the same number and opposite conclusions.
 */

type Counter = () => PromiseLike<{
  count: number | null;
  error: { message: string } | null;
  status?: number;
  statusText?: string;
}>;

/**
 * PostgREST returns an empty `message` on some failures — a 401 from a stale
 * key among them. The HTTP status is always present, so it stands in when the
 * message does not: an unreadable source that cannot say why is barely more
 * use than a wrong number.
 */
function describe(error: { message: string }, status?: number, statusText?: string): string {
  const message = (error.message ?? "").trim();
  if (message) return status ? `${message} (HTTP ${status})` : message;
  if (status) return `HTTP ${status}${statusText ? ` ${statusText}` : ""}`;
  return "read failed with no reported reason";
}

async function counted(source: string, run: Counter): Promise<{ value: number; error: UnreadableSource | null }> {
  try {
    const { count, error, status, statusText } = await run();
    if (error) return { value: 0, error: { source, error: describe(error, status, statusText) } };
    if (count === null) return { value: 0, error: { source, error: "read returned no count" } };
    return { value: count, error: null };
  } catch (cause) {
    return { value: 0, error: { source, error: cause instanceof Error ? cause.message : String(cause) } };
  }
}

export async function readAlertReport({
  now = new Date(),
  client = getSupabaseServerClient()
}: { now?: Date; client?: SupabaseClient | null } = {}): Promise<AlertReport> {
  if (!client) {
    // Not configured is not clean. It is a run that could not happen.
    return buildAlertReport(emptyInputs(), [{ source: "supabase", error: "Server storage is not configured." }], now);
  }

  const unverifiedCutoff = new Date(now.getTime() - SLA.resultUnverifiedHours * 3_600_000).toISOString();
  const settledCutoff = new Date(now.getTime() - SLA.pickUnsettledHours * 3_600_000).toISOString();
  const dayAgo = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const head = { count: "exact" as const, head: true };

  const reads = await Promise.all([
    counted("op_fixture_results.unverified", () =>
      client
        .from("op_fixture_results")
        .select("id", head)
        .eq("is_current", true)
        .neq("verification_state", "verified")
        .lt("final_at", unverifiedCutoff)
    ),
    counted("op_publications.unsettled", () =>
      client
        .from("op_publications")
        .select("id", head)
        .eq("publication_status", "published")
        .eq("settlement_status", "unsettled")
        .lt("kickoff_at", settledCutoff)
    ),
    counted("op_settlement_exceptions.close", () =>
      client
        .from("op_settlement_exceptions")
        .select("id", head)
        .in("kind", ["close_missing", "close_insufficient_sources"])
        .eq("state", "open")
    ),
    counted("op_settlement_exceptions.result_conflict", () =>
      client.from("op_settlement_exceptions").select("id", head).eq("kind", "result_conflict").eq("state", "open")
    ),
    counted("op_publication_settlements.corrections", () =>
      client.from("op_publication_settlements").select("id", head).eq("is_current", false).gte("created_at", dayAgo)
    ),
    counted("op_publication_settlements.recent", () =>
      client.from("op_publication_settlements").select("id", head).eq("is_current", true).gte("created_at", dayAgo)
    ),
    counted("op_publication_settlements.voids", () =>
      client
        .from("op_publication_settlements")
        .select("id", head)
        .eq("is_current", true)
        .eq("status", "void")
        .gte("created_at", dayAgo)
    )
  ]);

  const [unverified, unsettled, closeMissing, conflicts, corrections, settlements, voids] = reads;
  const couldNotCheck = reads.map((read) => read.error).filter((error): error is UnreadableSource => error !== null);

  // A median cannot be a PostgREST count, so lag comes from its own function.
  // Null is a real answer here — no measurable results yet — and is reported as
  // unknown rather than as fine, so a failed read is the only thing that lands
  // in couldNotCheck.
  let medianProviderLagMinutes: number | null = null;
  try {
    const { data, error } = await client.rpc("op_provider_result_lag_minutes");
    if (error) couldNotCheck.push({ source: "op_provider_result_lag_minutes", error: describe(error) });
    else if (typeof data === "number" && Number.isFinite(data)) medianProviderLagMinutes = data;
    else if (data !== null) {
      const parsed = Number(data);
      medianProviderLagMinutes = Number.isFinite(parsed) ? parsed : null;
    }
  } catch (cause) {
    couldNotCheck.push({
      source: "op_provider_result_lag_minutes",
      error: cause instanceof Error ? cause.message : String(cause)
    });
  }

  return buildAlertReport(
    {
      unverifiedBeyondSla: unverified!.value,
      unsettledBeyondSla: unsettled!.value,
      closeMissingNearCutoff: closeMissing!.value,
      openResultConflicts: conflicts!.value,
      correctionsLast24h: corrections!.value,
      settlementsLast24h: settlements!.value,
      voidsLast24h: voids!.value,
      medianProviderLagMinutes
    },
    couldNotCheck,
    now
  );
}

function emptyInputs(): AlertInputs {
  return {
    unverifiedBeyondSla: 0,
    unsettledBeyondSla: 0,
    closeMissingNearCutoff: 0,
    openResultConflicts: 0,
    correctionsLast24h: 0,
    settlementsLast24h: 0,
    voidsLast24h: 0,
    medianProviderLagMinutes: null
  };
}
