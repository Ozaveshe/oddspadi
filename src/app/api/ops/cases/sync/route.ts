import { requireStaff } from "@/lib/ops/staffAuth";
import { getSupabaseServerClient } from "@/lib/supabase/server";
import { privateJson } from "@/lib/security/privateJson";
import { caseFromException, humanizeKind, type CaseSeverity, type ExceptionRow } from "@/lib/ops/cases";
import { categoryForReport } from "@/lib/ops/caseCategories";
import { slaDueAt } from "@/lib/ops/serviceLevels";
import { opsMode } from "@/lib/ops/trainingMode";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

/**
 * Open a case for every open alert, idempotently.
 *
 * Reads the two alert queues READ-ONLY and, for each open row, calls
 * op_upsert_operational_case — which returns the existing open case or opens a
 * fresh one. The scheduled sweep runs this on a cron; a second run opens no
 * duplicate. It never rewrites the alert. An unreadable source is reported and
 * opens NOTHING — a case sync that half-read the queues is worse than one that
 * declined, so it is all-or-nothing per run.
 */

const LIMIT = 500;

/** Report category → case severity. Integrity abuse outranks noise. */
const REPORT_SEVERITY: Record<string, CaseSeverity> = {
  guaranteed_win_claim: "critical",
  scam_or_paid_tips: "critical",
  impersonation: "critical",
  unsafe_link: "warning",
  harassment: "warning",
  spam: "info",
  other: "info"
};

async function readOpen(
  client: SupabaseClient,
  table: string,
  columns: string,
  stateColumn: string,
  couldNotCheck: string[]
): Promise<Record<string, unknown>[]> {
  try {
    const { data, error } = await client.from(table).select(columns).eq(stateColumn, "open").limit(LIMIT);
    if (error) {
      couldNotCheck.push(table);
      return [];
    }
    return (data as unknown as Record<string, unknown>[] | null) ?? [];
  } catch {
    couldNotCheck.push(table);
    return [];
  }
}

export async function POST(request: Request): Promise<Response> {
  const gate = await requireStaff(request);
  if (!gate.ok) return gate.response;
  const client = getSupabaseServerClient();
  if (!client) return privateJson({ error: "Server storage is not configured." }, { status: 503 });

  const couldNotCheck: string[] = [];
  const exceptions = await readOpen(client, "op_settlement_exceptions", "id,kind,severity,detail", "state", couldNotCheck);
  const reports = await readOpen(client, "op_content_reports", "id,category,content_type,content_id", "status", couldNotCheck);

  // Never open a partial set of cases off a half-read queue.
  if (couldNotCheck.length > 0) {
    return privateJson({ error: "Could not read every alert queue.", couldNotCheck }, { status: 502 });
  }

  const now = new Date();
  const mode = opsMode(process.env);

  // Build the case rows we would open. In training mode we stop here.
  const exceptionCases = exceptions.map((row) =>
    caseFromException(
      { id: String(row.id), kind: String(row.kind), severity: row.severity as CaseSeverity, detail: (row.detail ?? {}) as Record<string, unknown> } as ExceptionRow,
      now,
      slaDueAt
    )
  );
  const reportCases = reports.map((row) => {
    const reportCategory = String(row.category);
    const severity = REPORT_SEVERITY[reportCategory] ?? "info";
    return {
      workspace: "community" as const,
      source: "content_report" as const,
      kind: `report_${reportCategory}`,
      category: categoryForReport(reportCategory),
      severity,
      title: `Report: ${humanizeKind(reportCategory)}`,
      reportId: String(row.id),
      dueAt: slaDueAt("community", severity, now).toISOString(),
      detail: {
        contentType: row.content_type,
        contentId: row.content_id,
        category: reportCategory,
        affectedEntities: row.content_id ? [String(row.content_id)] : [],
        evidence: `${reportCategory} report on ${row.content_type}`
      }
    };
  });

  if (mode === "training") {
    return privateJson({
      status: "training-preview",
      wouldOpen: exceptionCases.length + reportCases.length,
      fromExceptions: exceptionCases.length,
      fromReports: reportCases.length
    });
  }

  let opened = 0;
  const failed: string[] = [];

  for (const c of exceptionCases) {
    const { error } = await client.rpc("op_upsert_operational_case", {
      p_workspace: c.workspace,
      p_source: c.source,
      p_kind: c.kind,
      p_severity: c.severity,
      p_title: c.title,
      p_category: c.category,
      p_exception_id: c.exceptionId,
      p_report_id: null,
      p_due_at: c.dueAt,
      p_detail: c.detail
    });
    if (error) failed.push(`exception:${c.exceptionId}`);
    else opened += 1;
  }

  for (const c of reportCases) {
    const { error } = await client.rpc("op_upsert_operational_case", {
      p_workspace: c.workspace,
      p_source: c.source,
      p_kind: c.kind,
      p_severity: c.severity,
      p_title: c.title,
      p_category: c.category,
      p_exception_id: null,
      p_report_id: c.reportId,
      p_due_at: c.dueAt,
      p_detail: c.detail
    });
    if (error) failed.push(`report:${c.reportId}`);
    else opened += 1;
  }

  // A write failure mid-run is a genuine incident, not a clean run.
  if (failed.length > 0) {
    return privateJson({ status: "partial", processed: opened, failed: failed.length }, { status: 502 });
  }
  return privateJson({ status: "ok", processed: opened, fromExceptions: exceptionCases.length, fromReports: reportCases.length });
}
