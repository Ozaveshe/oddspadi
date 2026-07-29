#!/usr/bin/env node
/**
 * Project settled market decisions into op_prediction_outcomes.
 *
 *   node scripts/backfill-prediction-outcomes.mjs             # dry run
 *   node scripts/backfill-prediction-outcomes.mjs --commit
 *   node scripts/backfill-prediction-outcomes.mjs --commit --days 180
 *
 * Settlement and promotion read different tables. `ops:settle` writes
 * `op_market_decisions.settlement_status`, but the calibration candidate that
 * gates promotion is built from `op_prediction_outcomes`, which additionally
 * needs `odds` and `closing_odds`. Settling 10k decisions therefore moved the
 * promotion gate not at all — that table held 19 settled football rows against
 * 2,296 settled football decisions.
 *
 * Price provenance is recorded per row in metadata rather than assumed:
 *   decision-snapshot          struck price, taken from the decision's own
 *                              odds_snapshot_id
 *   reconstructed              last pre-match quote at or before generated_at,
 *                              for decisions written before odds_snapshot_id
 *                              started landing — an inference, labelled as one
 *   implausible-price-dropped  the quote was a feed sentinel (1001.00 and the
 *                              like); the probability is kept for Brier and ECE
 *                              while the price is nulled so closing-line value
 *                              ignores it
 *
 * Rows written here are internal: `sync_public_prediction_outcome` deliberately
 * keeps `market-decision-backfill` out of the publicly readable
 * op_public_prediction_outcomes. Calibration evidence is not a track record.
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

const days = Number(arg("days", "120"));
if (!Number.isFinite(days)) {
  console.error("--days must be a number.");
  process.exit(1);
}

const client = createClient(url, key, { auth: { persistSession: false } });
const since = new Date(Date.now() - days * 86_400_000).toISOString();

const { data, error } = await client.rpc("op_backfill_prediction_outcomes", {
  p_since: since,
  p_commit: commit
});
if (error) {
  console.error(error.message);
  process.exit(1);
}

console.log(`Fixtures kicking off since ${since.slice(0, 10)}.\n${commit ? "Wrote" : "Would write"}:`);
let total = 0;
for (const row of data ?? []) {
  total += Number(row.candidates);
  const closingCoverage = row.candidates > 0 ? Number(row.with_closing_price) / Number(row.candidates) : 0;
  console.log(
    `  ${String(row.sport).padEnd(11)} rows=${String(row.candidates).padStart(5)}  ` +
      `priced=${String(row.with_struck_price).padStart(5)}  ` +
      `closing=${String(row.with_closing_price).padStart(5)}  ` +
      `closing coverage=${(closingCoverage * 100).toFixed(1)}%` +
      (Number(row.with_struck_price) < Number(row.candidates)
        ? `  (${Number(row.candidates) - Number(row.with_struck_price)} implausible price${
            Number(row.candidates) - Number(row.with_struck_price) === 1 ? "" : "s"
          } dropped)`
        : "")
  );
}
if (!data?.length) console.log("  nothing new to project.");
console.log(`\ntotal=${total}`);
console.log(
  "\nClosing coverage below 0.80 blocks promotion. That is bounded by how close to\n" +
    "kickoff the odds feed polls, not by this script — run ops:closing-lines first."
);
if (!commit) console.log("\nDry run. Re-run with --commit to write.");
