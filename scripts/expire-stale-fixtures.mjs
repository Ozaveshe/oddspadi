#!/usr/bin/env node
/**
 * Clear fixtures whose kickoff has long passed with no provider update.
 *
 *   npm run ops:expire-fixtures              # dry run
 *   npm run ops:expire-fixtures -- --commit
 *
 * The window is measured from kickoff, per sport, not from the calendar. A
 * match starting at 23:00 is still being played at 00:30 and a best-of-five
 * tennis match starting at 22:00 can run past 02:00, so "clear yesterday at
 * midnight" would write off matches that are still on.
 *
 * Prefer the scheduled job (`results-refresh-sweep`), which re-reads the
 * provider first and only then expires what is genuinely missing. This command
 * is the manual equivalent of the second half, for when you want the board
 * cleared now.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(2);
}

const commit = process.argv.includes("--commit");
const db = createClient(url, key, { auth: { persistSession: false } });

const { data, error } = await db.rpc("op_expire_stale_fixtures", { p_commit: commit });
if (error) {
  console.error(`failed: ${error.message}`);
  process.exit(1);
}

const rows = data ?? [];
const total = rows.reduce((sum, row) => sum + Number(row.expired ?? 0), 0);

console.log(commit ? "EXPIRED" : "DRY RUN — nothing written");
if (!rows.length) {
  console.log("  no stale fixtures; every past kickoff has a provider status.");
} else {
  for (const row of rows) {
    console.log(`  ${String(row.sport).padEnd(12)} ${String(row.expired).padStart(6)}   oldest ${Number(row.oldest_hours).toFixed(1)}h past kickoff`);
  }
  console.log(`  ${"total".padEnd(12)} ${String(total).padStart(6)}`);
}
if (!commit && total > 0) console.log("\nRe-run with --commit to apply.");
