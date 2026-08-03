#!/usr/bin/env node
/**
 * Why is a fixture waiting for odds?
 *
 *   node --env-file-if-exists=.env.local scripts/diagnose-odds-coverage.mjs [--days 2]
 *
 * The public slate says "N provider fixtures are still waiting for current
 * odds or enough evidence". True, but useless on its own: it does not separate
 * the three very different reasons a fixture has no price.
 *
 *   1. The odds provider carries no market for that competition. No API tier
 *      fixes this, and the fixture should never have raised an expectation.
 *   2. It is carried, but the newest price is older than the decision gate
 *      allows. A cadence or quota problem, and the fixable half.
 *   3. It was priced and then pruned.
 *
 * Read-only.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const daysArg = Number(process.argv[process.argv.indexOf("--days") + 1]);
const days = Number.isFinite(daysArg) && daysArg > 0 ? daysArg : 2;

/** The decision gate's `maximumOddsAgeMinutes`. Older than this is unusable. */
const MAX_ODDS_AGE_MIN = 60;
const ODDS_WINDOW_HOURS = 48;
const ODDS_ROW_CAP = 150_000;

const now = new Date();

async function pageByRange(table, columns, build) {
  const rows = [];
  for (let offset = 0; offset < 40_000; offset += 1000) {
    const { data, error } = await build(db.from(table).select(columns)).range(offset, offset + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < 1000) break;
  }
  return rows;
}

/**
 * Keyset paging over odds, newest first.
 *
 * A deep `.range()` offset combined with ORDER BY makes Postgres sort the whole
 * matching set to reach the window; against 1.5M snapshots that trips the 8s
 * statement timeout. Dropping the ORDER BY to dodge the timeout is worse: it
 * returns an arbitrary slice, and the freshest rows are exactly what an
 * arbitrary slice misses — which reads as "no fresh odds anywhere" while fresh
 * odds are arriving. A `captured_at` cursor keeps each page an index scan and
 * guarantees the newest rows are the ones actually seen.
 */
async function newestOdds(sinceIso, maxRows) {
  const rows = [];
  let cursor = null;
  while (rows.length < maxRows) {
    let query = db
      .from("op_odds_snapshots")
      .select("fixture_external_id,captured_at")
      .gte("captured_at", sinceIso)
      .order("captured_at", { ascending: false })
      .limit(1000);
    if (cursor) query = query.lt("captured_at", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`op_odds_snapshots: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    const last = data[data.length - 1].captured_at;
    if (last === cursor) break;
    cursor = last;
    if (data.length < 1000) break;
  }
  return rows;
}

const fixtures = await pageByRange("op_fixtures", "external_id,sport,league_name,kickoff_at,status", (q) =>
  q
    .gte("kickoff_at", new Date(now.getTime() - 6 * 3_600_000).toISOString())
    .lte("kickoff_at", new Date(now.getTime() + days * 86_400_000).toISOString())
    .order("kickoff_at", { ascending: true })
);

const odds = await newestOdds(new Date(now.getTime() - ODDS_WINDOW_HOURS * 3_600_000).toISOString(), ODDS_ROW_CAP);

const pricedIds = new Set();
const freshIds = new Set();
const freshCutoff = now.getTime() - MAX_ODDS_AGE_MIN * 60_000;
for (const row of odds) {
  pricedIds.add(row.fixture_external_id);
  if (Date.parse(row.captured_at) >= freshCutoff) freshIds.add(row.fixture_external_id);
}

const byLeague = new Map();
for (const fixture of fixtures) {
  if (["finished", "cancelled", "abandoned", "postponed"].includes(fixture.status)) continue;
  const name = `${fixture.sport} · ${fixture.league_name ?? "unknown"}`;
  const bucket = byLeague.get(name) ?? { total: 0, everPriced: 0, freshlyPriced: 0 };
  bucket.total += 1;
  if (pricedIds.has(fixture.external_id)) bucket.everPriced += 1;
  if (freshIds.has(fixture.external_id)) bucket.freshlyPriced += 1;
  byLeague.set(name, bucket);
}

const rows = [...byLeague.entries()].map(([league, b]) => ({ league, ...b })).sort((a, b) => b.total - a.total);
const totals = rows.reduce(
  (a, r) => ({
    total: a.total + r.total,
    everPriced: a.everPriced + r.everPriced,
    freshlyPriced: a.freshlyPriced + r.freshlyPriced
  }),
  { total: 0, everPriced: 0, freshlyPriced: 0 }
);

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "n/a");
const capped = odds.length >= ODDS_ROW_CAP;

console.log(`Upcoming fixtures, next ${days} day(s): ${totals.total}`);
console.log(`  priced within ${ODDS_WINDOW_HOURS}h  : ${totals.everPriced} (${pct(totals.everPriced, totals.total)})`);
console.log(`  priced within ${MAX_ODDS_AGE_MIN}min : ${totals.freshlyPriced} (${pct(totals.freshlyPriced, totals.total)})  <- what the decision gate needs`);
console.log(`  never priced        : ${totals.total - totals.everPriced}\n`);

console.log("LEAGUE                                        TOTAL   ANY  FRESH  DIAGNOSIS");
for (const r of rows) {
  const diagnosis =
    r.everPriced === 0
      ? "provider carries no market"
      : r.freshlyPriced === 0
        ? "priced, but every price aged out"
        : r.freshlyPriced < r.total
          ? "partial"
          : "ok";
  console.log(
    `  ${r.league.slice(0, 42).padEnd(42)} ${String(r.total).padStart(5)} ${String(r.everPriced).padStart(5)} ${String(r.freshlyPriced).padStart(6)}  ${diagnosis}`
  );
}

const neverCarried = rows.filter((r) => r.everPriced === 0);
const staleOnly = rows.filter((r) => r.everPriced > 0 && r.freshlyPriced === 0);
const sum = (list) => list.reduce((n, r) => n + r.total, 0);

console.log("\n--- what this means ---");
console.log(`${sum(neverCarried)} fixtures across ${neverCarried.length} competition(s): no market from the odds provider.`);
console.log("   Not solvable by a bigger plan if the provider has no book for them.");
console.log(`${sum(staleOnly)} fixtures across ${staleOnly.length} competition(s): priced, but the newest price is too old.`);
console.log("   This is cadence or quota, and it is the fixable half.");

const ages = odds.map((r) => (now.getTime() - Date.parse(r.captured_at)) / 60_000).sort((a, b) => a - b);
if (ages.length) {
  const at = (p) => Math.round(ages[Math.floor((ages.length - 1) * p)]);
  console.log(`\nSnapshot age (min): newest ${Math.round(ages[0])}  p10 ${at(0.1)}  p50 ${at(0.5)}  p90 ${at(0.9)}`);
  console.log(`Snapshots read: ${odds.length}${capped ? " (ROW CAP — a lower bound, newest rows included)" : ""}`);
  const freshRows = ages.filter((a) => a <= MAX_ODDS_AGE_MIN).length;
  console.log(`Snapshots newer than ${MAX_ODDS_AGE_MIN} min: ${freshRows} (${pct(freshRows, ages.length)})`);
}
