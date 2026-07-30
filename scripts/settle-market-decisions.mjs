#!/usr/bin/env node
/**
 * Grade stored market decisions against finished fixtures.
 *
 *   node scripts/settle-market-decisions.mjs                 # dry run
 *   node scripts/settle-market-decisions.mjs --commit
 *   node scripts/settle-market-decisions.mjs --commit --days 120
 *
 * Settlement previously ran only over `op_public_picks`, which has never held a
 * row, so none of the engine's decisions were ever graded. Without graded
 * outcomes the calibration corpus cannot grow and no candidate can earn
 * promotion. This walks finished fixtures and settles their decisions so the
 * model finally learns whether it was right — including on calls it withheld.
 *
 * Defaults to a dry run. Nothing is written without --commit.
 */
import { createClient } from "@supabase/supabase-js";
import { gradeMarketDecision } from "../src/lib/sports/results/marketDecisionSettlement.ts";

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
const client = createClient(url, key, { auth: { persistSession: false } });
const since = new Date(Date.now() - days * 86_400_000).toISOString();

// Paginate by primary key. `.limit(20_000)` does not lift PostgREST's `max-rows`
// ceiling (1000 here), so this silently settled only the first thousand fixtures
// and reported that truncated count as if it were the whole range — leaving the
// rest permanently ungraded with no error to notice.
const fixtures = [];
{
  const pageSize = 1000;
  let cursor = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await client
      .from("op_fixtures")
      .select("id,sport,status,home_score,away_score,kickoff_at")
      .in("status", ["finished", "postponed", "cancelled"])
      .gte("kickoff_at", since)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    fixtures.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    cursor = data[data.length - 1].id;
  }
}
if (!fixtures.length) {
  console.log("No finished fixtures in range.");
  process.exit(0);
}
console.log(`${fixtures.length} finished/void fixtures since ${since.slice(0, 10)}.`);

const totals = { won: 0, lost: 0, push: 0, void: 0, needs_review: 0, updated: 0, failed: 0 };
const bySport = new Map();

for (let index = 0; index < fixtures.length; index += 200) {
  const batch = fixtures.slice(index, index + 200);
  const byId = new Map(batch.map((fixture) => [fixture.id, fixture]));
  const { data: decisions, error } = await client
    .from("op_market_decisions")
    .select("id,fixture_id,market,selection,settlement_status")
    .in("fixture_id", [...byId.keys()])
    .is("superseded_by", null)
    .in("settlement_status", ["pending", "needs_review"])
    .limit(20_000);
  if (error) {
    console.error(`batch ${index}: ${error.message}`);
    totals.failed += 1;
    continue;
  }

  for (const decision of decisions ?? []) {
    const fixture = byId.get(decision.fixture_id);
    if (!fixture) continue;
    const grade = gradeMarketDecision({
      market: decision.market,
      selection: decision.selection,
      fixture: {
        status: fixture.status,
        homeScore: fixture.home_score,
        awayScore: fixture.away_score
      }
    });
    totals[grade.result] += 1;
    const sportTotals = bySport.get(fixture.sport) ?? { won: 0, lost: 0, push: 0, void: 0, needs_review: 0 };
    sportTotals[grade.result] += 1;
    bySport.set(fixture.sport, sportTotals);

    // needs_review is already the stored state for ungradeable rows; only write
    // a real verdict so a failed grade never overwrites a good one.
    if (!commit || grade.result === "needs_review") continue;
    const { error: updateError } = await client
      .from("op_market_decisions")
      .update({ settlement_status: grade.result })
      .eq("id", decision.id);
    if (updateError) {
      totals.failed += 1;
      console.error(`${decision.id}: ${updateError.message}`);
      continue;
    }
    totals.updated += 1;
  }
}

console.log(`\n${commit ? "Settled" : "Would settle"}:`);
for (const [sport, sportTotals] of [...bySport.entries()].sort()) {
  const graded = sportTotals.won + sportTotals.lost + sportTotals.push;
  console.log(`  ${sport.padEnd(11)} won=${sportTotals.won} lost=${sportTotals.lost} push=${sportTotals.push} void=${sportTotals.void} ungradeable=${sportTotals.needs_review}  (${graded} usable outcomes)`);
}
console.log(`\ntotal graded=${totals.won + totals.lost + totals.push}  void=${totals.void}  ungradeable=${totals.needs_review}  written=${totals.updated}  failed=${totals.failed}`);
if (!commit) console.log("\nDry run. Re-run with --commit to write.");
if (totals.failed) process.exitCode = 1;
