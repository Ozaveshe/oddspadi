import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseRow } from "@/lib/ops/dashboardMetrics";
import type { CaseSeverity, CaseState, CaseWorkspace } from "@/lib/ops/cases";

/**
 * Thin, read-only glue between the ops pages and the case tables. Every read
 * records the sources it could NOT read, so the page can degrade honestly
 * rather than render a query failure as an empty (clear) queue.
 */

export type CaseRead = { rows: CaseRow[]; couldNotRead: string[] };

function toCaseRow(row: Record<string, unknown>): CaseRow {
  return {
    workspace: row.workspace as CaseWorkspace,
    category: (row.category as CaseRow["category"]) ?? null,
    severity: row.severity as CaseSeverity,
    state: row.state as CaseState,
    openedAt: String(row.opened_at),
    dueAt: (row.due_at as string | null) ?? null,
    resolvedAt: (row.resolved_at as string | null) ?? null
  };
}

export async function readCaseRows(client: SupabaseClient | null, workspace?: CaseWorkspace): Promise<CaseRead> {
  const couldNotRead: string[] = [];
  if (!client) return { rows: [], couldNotRead: ["storage"] };
  try {
    let query = client.from("op_operational_cases").select("workspace,category,severity,state,opened_at,due_at,resolved_at");
    if (workspace) query = query.eq("workspace", workspace);
    const { data, error } = await query.limit(1000);
    if (error) return { rows: [], couldNotRead: ["op_operational_cases"] };
    return { rows: ((data as Record<string, unknown>[] | null) ?? []).map(toCaseRow), couldNotRead };
  } catch {
    return { rows: [], couldNotRead: ["op_operational_cases"] };
  }
}

/** Count open rows of a queue, or null when the source cannot be read (never a false zero). */
export async function readOpenCount(
  client: SupabaseClient | null,
  table: string,
  stateColumn: string,
  kindPrefix?: string
): Promise<number | null> {
  if (!client) return null;
  try {
    let query = client.from(table).select("*", { count: "exact", head: true }).eq(stateColumn, "open");
    if (kindPrefix) query = query.like("kind", `${kindPrefix}%`);
    const { count, error } = await query;
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/** Count rows where a column equals a value, or null when unreadable. */
export async function readCountEq(client: SupabaseClient | null, table: string, column: string, value: string): Promise<number | null> {
  if (!client) return null;
  try {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).eq(column, value);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/** Count rows where a column is one of several values, or null when unreadable. */
export async function readCountIn(client: SupabaseClient | null, table: string, column: string, values: string[]): Promise<number | null> {
  if (!client) return null;
  try {
    const { count, error } = await client.from(table).select("*", { count: "exact", head: true }).in(column, values);
    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

/**
 * Correction rate: superseding/corrected publications as a percent of the
 * publications that could be corrected. Null when either count is unreadable,
 * or 0% when there are eligible publications but none corrected. Sourced from
 * op_publications.publication_status — the same column the reconciler reads.
 */
export async function readCorrectionRatePercent(client: SupabaseClient | null): Promise<number | null> {
  const corrected = await readCountEq(client, "op_publications", "publication_status", "corrected");
  const eligible = await readCountIn(client, "op_publications", "publication_status", ["published", "corrected", "retracted"]);
  if (corrected === null || eligible === null || eligible === 0) return corrected === null || eligible === null ? null : 0;
  return (corrected / eligible) * 100;
}
