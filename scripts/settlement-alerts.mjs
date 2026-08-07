#!/usr/bin/env node
/**
 * Settlement and closing-price alerts.
 *
 * Follows the reconcile-truth contract:
 *
 *   exit 0  clean, or warnings only
 *   exit 1  critical findings
 *   exit 2  could not complete
 *
 * It never reports zero on failure. An unreadable source is printed under
 * COULD NOT CHECK and forces exit 2, because a run that could not read its
 * sources has no basis for saying anything is clean — which is the exact defect
 * that made an earlier reconciler announce "0 projections" against a store
 * holding six.
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
const hoursAgo = (hours) => new Date(now.getTime() - hours * 3_600_000).toISOString();
const head = { count: "exact", head: true };

const couldNotCheck = [];
async function counted(source, build) {
  try {
    const { count, error } = await build();
    if (error) {
      couldNotCheck.push([source, error.message]);
      return 0;
    }
    if (count === null) {
      couldNotCheck.push([source, "read returned no count"]);
      return 0;
    }
    return count;
  } catch (cause) {
    couldNotCheck.push([source, cause instanceof Error ? cause.message : String(cause)]);
    return 0;
  }
}

const unverified = await counted("op_fixture_results.unverified", () =>
  client.from("op_fixture_results").select("id", head)
    .eq("is_current", true).neq("verification_state", "verified").lt("final_at", hoursAgo(3))
);
const unsettled = await counted("op_publications.unsettled", () =>
  client.from("op_publications").select("id", head)
    .eq("publication_status", "published").eq("settlement_status", "unsettled").lt("kickoff_at", hoursAgo(1))
);
const conflicts = await counted("op_settlement_exceptions.result_conflict", () =>
  client.from("op_settlement_exceptions").select("id", head).eq("kind", "result_conflict").eq("state", "open")
);
const closeMissing = await counted("op_settlement_exceptions.close", () =>
  client.from("op_settlement_exceptions").select("id", head)
    .in("kind", ["close_missing", "close_insufficient_sources"]).eq("state", "open")
);
const corrections = await counted("op_publication_settlements.corrections", () =>
  client.from("op_publication_settlements").select("id", head).eq("is_current", false).gte("created_at", hoursAgo(24))
);
const settlements = await counted("op_publication_settlements.recent", () =>
  client.from("op_publication_settlements").select("id", head).eq("is_current", true).gte("created_at", hoursAgo(24))
);
const voids = await counted("op_publication_settlements.voids", () =>
  client.from("op_publication_settlements").select("id", head)
    .eq("is_current", true).eq("status", "void").gte("created_at", hoursAgo(24))
);

const critical = [];
const warnings = [];

if (unverified > 0) critical.push(`result-unverified-sla: ${unverified} fixture(s) terminal over 3h, still unverified`);
if (unsettled > 0) critical.push(`pick-unsettled-sla: ${unsettled} published pick(s) unsettled over 1h past kickoff`);
if (conflicts > 0) critical.push(`result-conflict: ${conflicts} open conflict(s); no claim on these fixtures can settle`);
if (settlements >= 10 && voids / settlements > 0.15) {
  critical.push(`mass-void: ${((voids / settlements) * 100).toFixed(1)}% of ${settlements} settlements voided in 24h`);
}
if (closeMissing > 0) warnings.push(`close-missing: ${closeMissing} open closing-price exception(s)`);
if (corrections > 0) warnings.push(`settlement-correction: ${corrections} verdict(s) superseded in 24h`);

if (critical.length) {
  console.log("CRITICAL");
  for (const line of critical) console.log(`  ${line}`);
}
if (warnings.length) {
  console.log("WARNING");
  for (const line of warnings) console.log(`  ${line}`);
}
if (couldNotCheck.length) {
  console.log("COULD NOT CHECK");
  for (const [source, error] of couldNotCheck) console.log(`  ${source}: ${error}`);
}
if (!critical.length && !warnings.length && !couldNotCheck.length) {
  console.log("clean — no settlement or closing alerts");
}

process.exit(couldNotCheck.length ? 2 : critical.length ? 1 : 0);
