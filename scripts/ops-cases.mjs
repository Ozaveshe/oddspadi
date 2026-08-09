#!/usr/bin/env node
/**
 * Operational-case SLA report.
 *
 * Follows the reconcile-truth / settlement-alerts contract:
 *
 *   exit 0  clean — no breached cases
 *   exit 1  one or more cases past their resolution SLA
 *   exit 2  could not complete (unreadable source)
 *
 * Read-only. It never opens, edits or resolves a case — that is the workspace's
 * job. And it never reports zero on failure: an unreadable case table forces
 * exit 2, because a run that could not read has no basis for saying "clear".
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("COULD NOT CHECK");
  console.error("  supabase: SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(2);
}

const client = createClient(url, key, { auth: { persistSession: false } });
const now = new Date();
const ACTIVE = ["open", "acknowledged", "in_progress", "waiting", "escalated"];

let rows;
try {
  const { data, error, status, statusText } = await client
    .from("op_operational_cases")
    .select("id,workspace,severity,state,due_at,assignee_fingerprint,opened_at")
    .in("state", ACTIVE)
    .limit(1000);
  if (error) {
    console.error("COULD NOT CHECK");
    console.error(`  op_operational_cases: ${(error.message || "").trim() || `HTTP ${status} ${statusText ?? ""}`.trim()}`);
    process.exit(2);
  }
  rows = data ?? [];
} catch (cause) {
  console.error("COULD NOT CHECK");
  console.error(`  op_operational_cases: ${cause instanceof Error ? cause.message : String(cause)}`);
  process.exit(2);
}

const breached = rows.filter((r) => r.due_at && now.getTime() >= new Date(r.due_at).getTime());
const unassignedOverdue = breached.filter((r) => !r.assignee_fingerprint);

const bySeverity = { critical: 0, warning: 0, info: 0 };
const byWorkspace = { market_ops: 0, community: 0 };
for (const r of rows) {
  if (bySeverity[r.severity] !== undefined) bySeverity[r.severity] += 1;
  if (byWorkspace[r.workspace] !== undefined) byWorkspace[r.workspace] += 1;
}

console.log("OPEN CASES");
console.log(`  total: ${rows.length}  (market_ops ${byWorkspace.market_ops}, community ${byWorkspace.community})`);
console.log(`  by severity: critical ${bySeverity.critical}, warning ${bySeverity.warning}, info ${bySeverity.info}`);

if (breached.length === 0) {
  console.log("SLA: clean — no case is past its resolution deadline.");
  process.exit(0);
}

console.log("");
console.log(`SLA BREACHES: ${breached.length} (${unassignedOverdue.length} unassigned)`);
for (const r of breached.slice(0, 50)) {
  const overdueMins = Math.round((now.getTime() - new Date(r.due_at).getTime()) / 60_000);
  console.log(`  [${r.severity}] ${r.workspace} case ${r.id} — ${overdueMins}m overdue${r.assignee_fingerprint ? "" : " (unassigned)"}`);
}
process.exit(1);
