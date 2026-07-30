#!/usr/bin/env node
/**
 * Prune superseded odds snapshots.
 *
 *   node scripts/prune-stale-odds.mjs                # dry run
 *   node scripts/prune-stale-odds.mjs --commit
 *   node scripts/prune-stale-odds.mjs --commit --days 30
 *
 * Deletes non-closing quotes for finished fixtures older than the cutoff.
 * Closing quotes and struck prices (rows referenced by a decision's
 * odds_snapshot_id) are never touched — they are calibration evidence.
 */
import { createClient } from "@supabase/supabase-js";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}
const commit = process.argv.includes("--commit");

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}
const days = Number(arg("days", "14"));
const client = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await client.rpc("op_prune_stale_odds", {
  p_older_than_days: days,
  p_commit: commit
});
if (error) {
  console.error(error.message);
  process.exit(1);
}
console.log(`Superseded quotes older than ${days} days on finished fixtures.\n${commit ? "Deleted" : "Would delete"}:`);
let total = 0;
for (const row of data ?? []) {
  total += Number(row.prunable);
  console.log(`  ${String(row.sport).padEnd(11)} ${row.prunable}`);
}
if (!data?.length) console.log("  nothing prunable.");
console.log(`\ntotal=${total}`);
if (!commit) console.log("\nDry run. Re-run with --commit to delete.");
