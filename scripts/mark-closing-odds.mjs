#!/usr/bin/env node
/**
 * Flag closing odds snapshots for fixtures that have already kicked off.
 *
 *   node scripts/mark-closing-odds.mjs                    # dry run
 *   node scripts/mark-closing-odds.mjs --commit
 *   node scripts/mark-closing-odds.mjs --commit --days 30 --window 120
 *
 * `is_closing` is hardcoded false in the live odds write path, so before this
 * existed only the historical corpus importers ever produced a closing quote.
 * Closing snapshots stopped at 2026-05-24 (football) and 2024-11-17 (tennis)
 * while every stored decision is from 2026-07-18 onward — zero overlap, so
 * closing-line coverage was 0.00 and the >= 0.80 promotion gate could never be
 * met no matter what else was fixed.
 *
 * A closing quote cannot be recognised at capture time; you only know a snapshot
 * was the last one once kickoff has passed. So this is a sweep, not a change to
 * the write path, and it wants to run on a schedule after kickoffs.
 *
 * Coverage this produces is bounded by how close to kickoff the odds feed
 * actually polls. It cannot invent a quote that was never captured: football's
 * last pre-kickoff quote sits a median of ~4.4 hours out, which is why football
 * lands near 0.25 while tennis (median ~3 minutes) reaches ~0.58. Raising
 * football further is a capture-cadence problem, not a marking one.
 *
 * Defaults to a dry run. Nothing is written without --commit.
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

const days = Number(arg("days", "90"));
// Matches DEFAULT_FOOTBALL_CLOSING_WINDOW_MINUTES so a swept quote means the
// same thing as a corpus-imported one.
const windowMinutes = Number(arg("window", "90"));
if (!Number.isFinite(days) || !Number.isFinite(windowMinutes)) {
  console.error("--days and --window must be numbers.");
  process.exit(1);
}

const client = createClient(url, key, { auth: { persistSession: false } });
const since = new Date(Date.now() - days * 86_400_000).toISOString();

const { data, error } = await client.rpc("op_mark_closing_odds", {
  p_since: since,
  p_window_minutes: windowMinutes,
  p_commit: commit
});
if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(
  `Kickoffs since ${since.slice(0, 10)}, closing window ${windowMinutes} minutes.\n` +
    `${commit ? "Marked" : "Would mark"}:`
);
let totalQuotes = 0;
for (const row of data ?? []) {
  totalQuotes += Number(row.quotes_marked);
  const coverage = row.fixtures_in_scope > 0 ? Number(row.fixtures_with_closing) / Number(row.fixtures_in_scope) : 0;
  console.log(
    `  ${String(row.sport).padEnd(11)} quotes=${String(row.quotes_marked).padStart(6)}  ` +
      `fixtures=${String(row.fixtures_with_closing).padStart(5)}/${String(row.fixtures_in_scope).padEnd(5)}  ` +
      `fixture coverage=${(coverage * 100).toFixed(1)}%`
  );
}
if (!data?.length) console.log("  nothing eligible in range.");
console.log(`\ntotal quotes ${commit ? "marked" : "eligible"}=${totalQuotes}`);
if (!commit) console.log("\nDry run. Re-run with --commit to write.");
