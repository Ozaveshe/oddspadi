#!/usr/bin/env node
/**
 * Classify every legacy prediction-like record against the canonical taxonomy
 * and report what OddsPadi can honestly claim as an official public pick.
 *
 *   node scripts/reconcile-publication-ledger.mjs                # dry run + report
 *   node scripts/reconcile-publication-ledger.mjs --commit       # also write recovered picks
 *   node scripts/reconcile-publication-ledger.mjs --report docs/legacy-reconciliation-report.md
 *
 * Safe to re-run: classification is derived, recovery is keyed on the source
 * record so a second run inserts nothing new.
 *
 * The recovery bar is deliberately strict. A legacy row becomes an official
 * publication only if ALL of the following can be shown from stored data:
 *
 *   - it came from the public-pick ledger (op_public_picks), the only store
 *     that ever represented "we showed this to the public";
 *   - it has a publication timestamp strictly before its fixture's kickoff;
 *   - it resolves to a canonical fixture;
 *   - it has a market, a selection and a plausible price at publication.
 *
 * Anything failing any test is classified non-official and reported as such.
 * Nothing is inferred, back-dated or reconstructed to make the record look
 * fuller: an unprovable pick is not a pick.
 */
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const commit = process.argv.includes("--commit");
const reportIndex = process.argv.indexOf("--report");
const reportPath = reportIndex === -1 ? null : process.argv[reportIndex + 1];

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}
const client = createClient(url, key, { auth: { persistSession: false } });

let readFailures = 0;

/**
 * Count without fetching rows, keeping a failed read distinguishable from a
 * real zero.
 *
 * A null count with no error is treated as a failure too: PostgREST can return
 * one when the count header is missing, and silently rendering that as 0 would
 * reproduce inside this very tool the bug it exists to find.
 */
async function count(table, apply = (query) => query) {
  const exact = await apply(client.from(table).select("*", { count: "exact", head: true }));
  if (!exact.error && typeof exact.count === "number") {
    return { value: exact.count, error: null, estimated: false };
  }
  // The largest stores (600k+ rows) exceed the API role's 8s statement timeout
  // on an exact count. A planner estimate is still a truthful answer as long
  // as the report says it is an estimate — silently dropping the row, or
  // printing zero, would not be.
  const estimated = await apply(client.from(table).select("*", { count: "estimated", head: true }));
  if (!estimated.error && typeof estimated.count === "number") {
    return { value: estimated.count, error: null, estimated: true };
  }
  readFailures += 1;
  return {
    value: null,
    error: exact.error?.message || estimated.error?.message || "count unavailable (exact and estimated both failed)",
    estimated: false
  };
}

const inspected = [];
function record(store, recordClass, result, note) {
  inspected.push({ store, recordClass, count: result.value, error: result.error, estimated: result.estimated, note });
}

console.log("Reading legacy stores...\n");

// --- The only store that ever meant "published to the public" -------------
const publicPicks = await count("op_public_picks");
record("op_public_picks", "official_public_pick (candidate)", publicPicks, "The intended official ledger.");

// --- Internal engine evidence ---------------------------------------------
record("op_market_decisions", "internal_decision", await count("op_market_decisions"),
  "Per-market engine decisions; training evidence, never publicly claimed.");
record("op_prediction_outcomes", "internal_decision", await count("op_prediction_outcomes", (q) => q.eq("source", "market-decision-backfill")),
  "Graded internal decisions reconstructed from market decisions.");
record("op_fixture_decision_summaries", "internal_decision", await count("op_fixture_decision_summaries"),
  "Canonical per-fixture decision summaries behind the slate.");

// --- Shadow / paper plane --------------------------------------------------
record("op_prediction_outcomes", "shadow_decision", await count("op_prediction_outcomes", (q) => q.eq("source", "autonomous-shadow")),
  "Paper-mode candidate runs. Explicitly not public.");
record("op_shadow_predictions", "shadow_decision", await count("op_shadow_predictions"),
  "Challenger predictions held in shadow.");
record("op_public_prediction_outcomes", "shadow_decision", await count("op_public_prediction_outcomes", (q) => q.eq("record_class", "shadow_decision")),
  "Shadow rows that were reaching the anon-readable mirror before the allowlist fix.");

// --- Simulation / backtest -------------------------------------------------
record("op_public_prediction_outcomes", "simulation", await count("op_public_prediction_outcomes", (q) => q.eq("record_class", "simulation")),
  "Developer smoke-test rows found in the public mirror.");
record("op_backtest_runs", "backtest_record", await count("op_backtest_runs"),
  "Historical replays. Never live performance.");

// --- Editorial -------------------------------------------------------------
record("op_editorial_stories", "editorial_observation", await count("op_editorial_stories"),
  "Generated stories. Commentary about picks, never picks.");

// --- Community -------------------------------------------------------------
record("op_community_tips", "community_selection", await count("op_community_tips"),
  "Visitor tips. Separate ledger, separate leaderboard.");
record("op_community_tip_settlements", "community_selection", await count("op_community_tip_settlements"),
  "Settlements for community tips.");

// --- Recovery: can any legacy row be proven an official pick? --------------
const recovery = {
  candidates: 0,
  recovered: 0,
  missingTimestamp: 0,
  missingOdds: 0,
  missingFixtureIdentity: 0,
  publishedAfterKickoff: 0,
  manualReview: 0,
  conflictingSettlements: 0,
  rejections: []
};

if (publicPicks.error) {
  recovery.rejections.push(`op_public_picks could not be read: ${publicPicks.error}`);
} else if ((publicPicks.value ?? 0) > 0) {
  const { data: rows, error } = await client
    .from("op_public_picks")
    .select("id,fixture_id,fixture_db_id,sport,league,market,selection,selection_label,market_line,odds,model_probability,implied_probability,published_at,kickoff_at,model_version,engine_version,status,settlement_status,result,settled_at,data_quality")
    .limit(1000);
  if (error) {
    recovery.rejections.push(`op_public_picks detail read failed: ${error.message}`);
  } else {
    for (const row of rows ?? []) {
      recovery.candidates += 1;
      const reasons = [];
      const published = Date.parse(row.published_at ?? "");
      const kickoff = Date.parse(row.kickoff_at ?? "");
      if (!Number.isFinite(published)) { reasons.push("missing publication timestamp"); recovery.missingTimestamp += 1; }
      if (!Number.isFinite(kickoff)) { reasons.push("missing kickoff"); recovery.missingTimestamp += 1; }
      if (Number.isFinite(published) && Number.isFinite(kickoff) && published >= kickoff) {
        reasons.push("published at or after kickoff");
        recovery.publishedAfterKickoff += 1;
      }
      if (!row.fixture_db_id) { reasons.push("no canonical fixture link"); recovery.missingFixtureIdentity += 1; }
      if (!(Number(row.odds) > 1)) { reasons.push("no plausible price at publication"); recovery.missingOdds += 1; }
      if (!row.market || !row.selection) { reasons.push("no market/selection"); recovery.manualReview += 1; }

      if (reasons.length) {
        recovery.rejections.push(`${row.id}: ${reasons.join("; ")}`);
        continue;
      }
      if (!commit) { recovery.recovered += 1; continue; }

      const { error: insertError } = await client.from("op_publications").insert({
        fixture_id: row.fixture_db_id,
        fixture_external_id: row.fixture_id,
        sport: row.sport,
        competition: row.league,
        market: row.market,
        selection: row.selection,
        selection_label: row.selection_label ?? row.selection,
        market_line: row.market_line,
        // Legacy rows predate per-component versioning; recording the truth
        // ("legacy") beats inventing a version string that never existed.
        model_version: row.model_version ?? "legacy-unknown",
        feature_set_version: "legacy-unknown",
        calibration_version: "legacy-unknown",
        decision_policy_version: row.engine_version ?? "legacy-unknown",
        model_probability: row.model_probability,
        odds_at_publication: row.odds,
        implied_probability: row.implied_probability,
        published_at: row.published_at,
        kickoff_at: row.kickoff_at,
        evidence_cutoff_at: row.published_at,
        odds_snapshot_at: row.published_at,
        data_quality: Number(row.data_quality) >= 0.8 ? "complete" : "partial",
        decision_status: "pick",
        publication_status: "published",
        metadata: { recoveredFrom: "op_public_picks", legacyId: row.id }
      });
      if (insertError) {
        // 23505 = already recovered by an earlier run; that is success, not failure.
        if (insertError.code === "23505") recovery.recovered += 1;
        else recovery.rejections.push(`${row.id}: insert failed — ${insertError.message}`);
        continue;
      }
      recovery.recovered += 1;
    }
  }
}

// Conflicting settlements: a publication whose denormalised status disagrees
// with its current settlement row, or that somehow has two current rows.
// Either would let two surfaces legitimately disagree about the same pick.
{
  const { data: ledgerRows, error: ledgerError } = await client
    .from("op_publications")
    .select("id,settlement_status")
    .limit(1000);
  const { data: settlementRows, error: settlementError } = await client
    .from("op_publication_settlements")
    .select("publication_id,status,is_current")
    .eq("is_current", true)
    .limit(1000);
  if (ledgerError || settlementError) {
    recovery.rejections.push(`settlement conflict scan failed: ${ledgerError?.message ?? settlementError?.message}`);
  } else {
    const current = new Map();
    for (const row of settlementRows ?? []) {
      if (current.has(row.publication_id)) recovery.conflictingSettlements += 1;
      current.set(row.publication_id, row.status);
    }
    for (const row of ledgerRows ?? []) {
      const settled = current.get(row.id);
      if (settled && settled !== row.settlement_status) recovery.conflictingSettlements += 1;
    }
  }
}

// An audit that cannot read its sources has no findings, only an outage. It
// must say so and fail, never print a tidy table of zeros.
if (readFailures) {
  console.error(`\n${readFailures} store read(s) failed — refusing to emit an audit report built on unread data.`);
  for (const entry of inspected.filter((item) => item.error)) {
    console.error(`  ${entry.store} (${entry.recordClass}): ${entry.error}`);
  }
  process.exit(1);
}

const totalInspected = inspected.reduce((sum, entry) => sum + (entry.count ?? 0), 0);
const byClass = new Map();
for (const entry of inspected) {
  const key = entry.recordClass.replace(" (candidate)", "");
  byClass.set(key, (byClass.get(key) ?? 0) + (entry.count ?? 0));
}

const lines = [];
lines.push("# Legacy reconciliation audit");
lines.push("");
lines.push(`Generated ${new Date().toISOString()} · mode: ${commit ? "commit" : "dry run"}`);
lines.push("");
lines.push("## Totals");
lines.push("");
lines.push(`- **Total legacy objects inspected:** ${totalInspected.toLocaleString()}`);
lines.push(`- **Official picks recovered:** ${recovery.recovered}`);
for (const [recordClass, value] of [...byClass.entries()].sort((a, b) => b[1] - a[1])) {
  if (recordClass === "official_public_pick") continue;
  lines.push(`- ${recordClass.replaceAll("_", " ")}: ${value.toLocaleString()}`);
}
lines.push("");
lines.push("## Recovery detail");
lines.push("");
lines.push(`- Candidates examined (op_public_picks): ${recovery.candidates}`);
lines.push(`- Records missing timestamps: ${recovery.missingTimestamp}`);
lines.push(`- Records missing odds: ${recovery.missingOdds}`);
lines.push(`- Records missing fixture identity: ${recovery.missingFixtureIdentity}`);
lines.push(`- Records published at or after kickoff: ${recovery.publishedAfterKickoff}`);
lines.push(`- Records requiring manual review: ${recovery.manualReview}`);
lines.push(`- Conflicting settlements: ${recovery.conflictingSettlements}`);
lines.push("");
lines.push("## Store-by-store");
lines.push("");
lines.push("| Store | Class | Rows | Note |");
lines.push("|---|---|---|---|");
for (const entry of inspected) {
  const value = entry.error ? "read failed" : `${entry.estimated ? "≈" : ""}${(entry.count ?? 0).toLocaleString()}`;
  const note = entry.error ?? `${entry.note}${entry.estimated ? " (planner estimate; exact count exceeds the statement timeout)" : ""}`;
  lines.push(`| \`${entry.store}\` | ${entry.recordClass} | ${value} | ${note} |`);
}
if (recovery.rejections.length) {
  lines.push("");
  lines.push("## Rejected candidates");
  lines.push("");
  for (const rejection of recovery.rejections.slice(0, 50)) lines.push(`- ${rejection}`);
  if (recovery.rejections.length > 50) lines.push(`- …and ${recovery.rejections.length - 50} more`);
}

const report = lines.join("\n");
console.log(report);
if (reportPath) {
  writeFileSync(reportPath, `${report}\n`, "utf8");
  console.log(`\nWritten to ${reportPath}`);
}
if (!commit) console.log("\nDry run. Re-run with --commit to write recovered publications.");
