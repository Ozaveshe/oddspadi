#!/usr/bin/env node
/**
 * The publisher run: qualifying decisions in, official publications out.
 *
 *   npm run ops:run-publisher                 # dry run, prints what would publish
 *   npm run ops:run-publisher -- --commit
 *   npm run ops:run-publisher -- --commit --hours 6
 *
 * Reads recent decisions, filters them through the same calibrated-band and
 * edge rules the rest of the product uses, keeps the best selection per
 * fixture-market, and calls `op_publish_pick` for each survivor. Every refusal
 * is reported: a run that publishes 101 of 28,032 candidates and says nothing
 * about the other 27,931 is not auditable.
 *
 * Defaults to a dry run. Nothing is written without --commit.
 *
 * Runs through vite-node because the gate itself lives in
 * `src/lib/publication/runPublicationCycle`, shared with the scheduled
 * publication worker. This script used to carry its own copy of the rules in
 * plain JS; two implementations of a gate that writes to an immutable ledger is
 * how the ledger ends up disagreeing with itself.
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { runPublicationCycle } from "@/lib/publication/runPublicationCycle";

// Loaded here rather than via `node --env-file`, because this runs through
// vite-node (to resolve `@/`) and so does not get node's own env-file flag.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // Absent in CI and in production, where the environment is already set.
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(2);
}

const commit = process.argv.includes("--commit");
const hoursArg = Number(process.argv[process.argv.indexOf("--hours") + 1]);
const hours = Number.isFinite(hoursArg) && hoursArg > 0 ? hoursArg : 12;

const client = createClient(url, key, { auth: { persistSession: false } });

const result = await runPublicationCycle({ client, hours, commit });

if (result.haltedReason) {
  console.log(result.haltedReason);
  console.log("Nothing to do.");
  process.exit(0);
}

for (const [sport, summary] of Object.entries(result.bandSummary)) {
  console.log(`${sport}: ${summary.settledOutcomes} settled outcomes, ${summary.publishableBands}/10 bands publishable`);
}

const buckets: Record<string, number> = { "<=10%": 0, "10-15%": 0, "15-20%": 0, "20-30%": 0, ">30%": 0 };
for (const entry of result.selected) {
  const edge = entry.edge;
  if (edge <= 0.1) buckets["<=10%"] += 1;
  else if (edge <= 0.15) buckets["10-15%"] += 1;
  else if (edge <= 0.2) buckets["15-20%"] += 1;
  else if (edge <= 0.3) buckets["20-30%"] += 1;
  else buckets[">30%"] += 1;
}

console.log("edge distribution of the selection:", JSON.stringify(buckets));
console.log(`decisions read      : ${result.read} (last ${hours}h, approved sports only)`);
console.log(
  `selected to publish : ${result.selected.length}${result.selected.length > result.capped.length ? ` (capped to ${result.capped.length} by the blast-radius bound)` : ""}`
);
console.log(`already live        : ${result.reused}`);
console.log(`distinct fixtures   : ${result.distinctFixtures}`);

console.log("\nrejections:");
for (const [reason, count] of Object.entries(result.rejections).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(count).padStart(7)}  ${reason}`);
}

console.log("\ntop of the queue:");
for (const entry of result.capped.slice(0, 8)) {
  console.log(
    `  ${entry.row.sport.padEnd(11)} ${entry.row.market.padEnd(16)} ${entry.row.selection.padEnd(8)} ` +
      `edge ${(entry.edge * 100).toFixed(1).padStart(5)}%  @ ${(1 / entry.implied).toFixed(2)}  ${entry.fixture.league_name ?? ""}` +
      `${entry.alreadyLive ? "  (already live)" : ""}`
  );
}

if (!commit) {
  const fresh = result.capped.filter((entry) => !entry.alreadyLive).length;
  console.log(`\nDRY RUN. Re-run with --commit to publish ${fresh}.`);
  process.exit(0);
}

const failed = Object.values(result.failures).reduce((total, count) => total + count, 0);
console.log(`\npublished: ${result.published}   already live: ${result.reused}   failed: ${failed}`);
for (const [message, count] of Object.entries(result.failures)) console.log(`  ${count}x ${message}`);
