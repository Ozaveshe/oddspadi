#!/usr/bin/env node
/**
 * The publisher run: qualifying decisions in, official publications out.
 *
 *   npm run ops:run-publisher                 # dry run, prints what would publish
 *   npm run ops:run-publisher -- --commit
 *   npm run ops:run-publisher -- --commit --hours 6
 *
 * Reads today's decisions, filters them through the same calibrated-band and
 * edge rules the rest of the product uses, keeps the best selection per
 * fixture-market, and calls `op_publish_pick` for each survivor. Every refusal
 * is reported: a run that publishes 40 of 300 candidates and says nothing about
 * the other 260 is not auditable.
 *
 * Defaults to a dry run. Nothing is written without --commit.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(2);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const commit = process.argv.includes("--commit");
const hoursArg = Number(process.argv[process.argv.indexOf("--hours") + 1]);
const hours = Number.isFinite(hoursArg) && hoursArg > 0 ? hoursArg : 12;

/** Minimum sample and maximum drift before a probability band may be published. */
const MIN_BAND_SAMPLE = 30;
const MAX_BAND_GAP = 0.05;

/**
 * Implausibility ceiling on edge.
 *
 * A model claiming to beat a priced market by more than this is far more likely
 * to be broken, or reading a stale or mismatched odds row, than to have found
 * value. The decision engine already applies 0.15 to uncalibrated runtimes for
 * exactly this reason; a calibrated profile earns a little more room, not
 * unlimited room.
 *
 * The first dry run put four picks above 30% at the top of the queue — a 35.7%
 * edge on a 13.00 shot, meaning the model rated a 7.7% chance at 43%. Publishing
 * that into an immutable ledger because the arithmetic said so would be trusting
 * the model over the market at precisely the point the model is least credible.
 */
const MAX_PLAUSIBLE_EDGE = 0.2;

const controls = await db.from("op_publication_controls").select("*").maybeSingle();
if (controls.error) {
  console.error(`could not read controls: ${controls.error.message}`);
  process.exit(2);
}
if (!controls.data?.publishing_enabled) {
  console.log(`publishing is DISABLED${controls.data?.disabled_reason ? ` — ${controls.data.disabled_reason}` : ""}`);
  console.log("Nothing to do. Enable with: npm run ops:publish -- --enable --by <name> --commit");
  process.exit(0);
}
const cap = controls.data.max_publications_per_run;

// Live approvals decide which sports may publish at all.
const promos = await db
  .from("op_calibration_promotions")
  .select("sport,model_key,engine_version,approved_by")
  .eq("status", "approved");
if (promos.error) {
  console.error(`could not read promotions: ${promos.error.message}`);
  process.exit(2);
}
const approvedBySport = new Map((promos.data ?? []).map((row) => [row.sport, row]));
if (!approvedBySport.size) {
  console.log("No approved calibration promotion exists, so nothing may publish.");
  process.exit(0);
}

/**
 * Calibration bands, computed from settled outcomes.
 *
 * `op_calibration_runs` stores headline metrics but not the per-bucket
 * breakdown — the buckets are derived at read time by the calibration module.
 * Rather than depend on an HTTP round trip to the app, the publisher runs the
 * same aggregation directly: settled outcomes grouped into decile bands, with
 * the count and the gap between predicted and realised rate. Identical
 * definition, one less moving part in a job that writes to the ledger.
 */
const bandsBySport = new Map();
for (const sport of approvedBySport.keys()) {
  const outcomes = [];
  for (let offset = 0; offset < 20000; offset += 1000) {
    const { data, error } = await db
      .from("op_prediction_outcomes")
      .select("model_probability,result")
      .eq("sport", sport)
      .in("result", ["won", "lost"])
      .not("model_probability", "is", null)
      .range(offset, offset + 999);
    if (error) {
      console.error(`could not read ${sport} outcomes: ${error.message}`);
      process.exit(2);
    }
    if (!data?.length) break;
    outcomes.push(...data);
    if (data.length < 1000) break;
  }

  const bands = Array.from({ length: 10 }, (_, index) => {
    const lowerBound = index / 10;
    const upperBound = (index + 1) / 10;
    const inBand = outcomes.filter((row) => {
      const probability = Number(row.model_probability);
      return probability >= lowerBound && probability < upperBound;
    });
    if (!inBand.length) return { lowerBound, upperBound, settledSize: 0, calibrationGap: null };
    const wins = inBand.filter((row) => row.result === "won").length;
    const winRate = wins / inBand.length;
    const meanProbability = inBand.reduce((sum, row) => sum + Number(row.model_probability), 0) / inBand.length;
    return { lowerBound, upperBound, settledSize: inBand.length, calibrationGap: Math.abs(meanProbability - winRate) };
  });
  bandsBySport.set(sport, bands);

  const usable = bands.filter((band) => band.settledSize >= MIN_BAND_SAMPLE && (band.calibrationGap ?? 1) <= MAX_BAND_GAP);
  console.log(`${sport}: ${outcomes.length} settled outcomes, ${usable.length}/10 bands publishable`);
}

function bandFor(probability, bands) {
  return bands.find((band) => probability >= band.lowerBound && probability < band.upperBound) ?? null;
}

// Candidates: decisions generated recently, on fixtures that have not started.
const since = new Date(Date.now() - hours * 3_600_000).toISOString();
const rows = [];
let cursor = null;
for (let page = 0; page < 80; page += 1) {
  let query = db
    .from("op_market_decisions")
    .select("fixture_id,fixture_external_id,sport,market,selection,model_probability,implied_probability,no_vig_probability,value_edge,odds_snapshot_id,model_version,engine_version,data_quality,generated_at")
    .gte("generated_at", since)
    .in("sport", [...approvedBySport.keys()])
    .order("generated_at", { ascending: false })
    .limit(1000);
  if (cursor) query = query.lt("generated_at", cursor);
  const { data, error } = await query;
  if (error) {
    console.error(`could not read decisions: ${error.message}`);
    process.exit(2);
  }
  if (!data?.length) break;
  rows.push(...data);
  const last = data[data.length - 1].generated_at;
  if (last === cursor) break;
  cursor = last;
  if (data.length < 1000) break;
}

// Fixture identity and kickoff, for the rows we actually hold.
const fixtureIds = [...new Set(rows.map((row) => row.fixture_id).filter(Boolean))];
const fixtures = new Map();
for (let index = 0; index < fixtureIds.length; index += 200) {
  const { data } = await db
    .from("op_fixtures")
    .select("id,external_id,league_name,kickoff_at,status")
    .in("id", fixtureIds.slice(index, index + 200));
  for (const fixture of data ?? []) fixtures.set(fixture.id, fixture);
}

const now = Date.now();
const rejected = new Map();
const bestByMarket = new Map();
const reject = (reason) => rejected.set(reason, (rejected.get(reason) ?? 0) + 1);

for (const row of rows) {
  const fixture = fixtures.get(row.fixture_id);
  if (!fixture) { reject("fixture row missing"); continue; }
  if (fixture.status !== "scheduled") { reject("fixture is not scheduled"); continue; }
  if (Date.parse(fixture.kickoff_at) <= now) { reject("kickoff has passed"); continue; }

  const model = Number(row.model_probability);
  const implied = Number(row.implied_probability);
  const fair = row.no_vig_probability === null ? null : Number(row.no_vig_probability);
  if (!Number.isFinite(model) || !Number.isFinite(implied) || implied <= 0) { reject("no usable probability"); continue; }
  if (fair === null || !Number.isFinite(fair)) { reject("no margin-free price"); continue; }

  const bands = bandsBySport.get(row.sport) ?? [];
  const band = bandFor(model, bands);
  if (!band) { reject("no calibration band covers this probability"); continue; }
  if (band.settledSize < MIN_BAND_SAMPLE) { reject(`band has only ${band.settledSize} settled outcomes`); continue; }
  if (band.calibrationGap === null || band.calibrationGap > MAX_BAND_GAP) { reject("band calibration gap too wide"); continue; }

  const edge = model - fair;
  const premium = Math.max(0, band.calibrationGap);
  if (edge <= premium) { reject("edge does not clear the band premium"); continue; }
  if (edge > MAX_PLAUSIBLE_EDGE) {
    reject(`edge ${(edge * 100).toFixed(0)}% exceeds the ${MAX_PLAUSIBLE_EDGE * 100}% plausibility ceiling; treated as a model fault, not value`);
    continue;
  }

  const key = `${row.fixture_id}::${row.market}`;
  const incumbent = bestByMarket.get(key);
  if (!incumbent || edge > incumbent.edge || (edge === incumbent.edge && model > incumbent.model)) {
    if (incumbent) reject("superseded by a larger edge in the same market");
    bestByMarket.set(key, { row, fixture, edge, model, implied, fair });
  } else {
    reject("another selection in this market carries a larger edge");
  }
}

const selected = [...bestByMarket.values()].sort((a, b) => b.edge - a.edge);
const capped = selected.slice(0, cap);

const buckets = { "<=10%": 0, "10-15%": 0, "15-20%": 0, "20-30%": 0, ">30%": 0 };
for (const entry of selected) {
  const e = entry.edge;
  if (e <= 0.10) buckets["<=10%"] += 1;
  else if (e <= 0.15) buckets["10-15%"] += 1;
  else if (e <= 0.20) buckets["15-20%"] += 1;
  else if (e <= 0.30) buckets["20-30%"] += 1;
  else buckets[">30%"] += 1;
}
console.log("edge distribution of the selection:", JSON.stringify(buckets));
console.log(`decisions read      : ${rows.length} (last ${hours}h, approved sports only)`);
console.log(`selected to publish : ${selected.length}${selected.length > cap ? ` (capped to ${cap} by the blast-radius bound)` : ""}`);
console.log(`distinct fixtures   : ${new Set(capped.map((entry) => entry.row.fixture_id)).size}`);
console.log("\nrejections:");
for (const [reason, count] of [...rejected.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(count).padStart(7)}  ${reason}`);
}

console.log("\ntop of the queue:");
for (const entry of capped.slice(0, 8)) {
  console.log(
    `  ${entry.row.sport.padEnd(11)} ${entry.row.market.padEnd(16)} ${entry.row.selection.padEnd(8)} ` +
      `edge ${(entry.edge * 100).toFixed(1).padStart(5)}%  @ ${(1 / entry.implied).toFixed(2)}  ${entry.fixture.league_name ?? ""}`
  );
}

if (!commit) {
  console.log(`\nDRY RUN. Re-run with --commit to publish ${capped.length}.`);
  process.exit(0);
}

let published = 0;
let reused = 0;
const failures = new Map();
for (const entry of capped) {
  const promo = approvedBySport.get(entry.row.sport);
  const { data, error } = await db.rpc("op_publish_pick", {
    p_fixture_id: entry.row.fixture_id,
    p_fixture_external_id: entry.row.fixture_external_id ?? entry.fixture.external_id,
    p_sport: entry.row.sport,
    p_competition: entry.fixture.league_name ?? "Unknown",
    p_market: entry.row.market,
    p_selection: entry.row.selection,
    p_selection_label: `${entry.row.market} / ${entry.row.selection}`,
    p_model_version: promo.model_key,
    p_feature_set_version: `${entry.row.sport}-runtime-features-v5`,
    p_calibration_version: promo.model_key,
    p_decision_policy_version: entry.row.engine_version ?? "decision-engine-v2",
    p_model_probability: entry.model,
    p_odds_at_publication: 1 / entry.implied,
    p_implied_probability: entry.implied,
    p_kickoff_at: entry.fixture.kickoff_at,
    p_evidence_cutoff_at: entry.row.generated_at,
    p_odds_snapshot_at: entry.row.generated_at,
    p_odds_snapshot_id: entry.row.odds_snapshot_id,
    p_data_quality: ["complete", "partial", "stale", "unavailable", "confirmed_empty"].includes(entry.row.data_quality)
      ? entry.row.data_quality
      : "partial",
    p_market_line: null
  });
  if (error) {
    failures.set(error.message, (failures.get(error.message) ?? 0) + 1);
    continue;
  }
  if (data) published += 1;
  else reused += 1;
}

console.log(`\npublished: ${published}   already live: ${reused}   failed: ${[...failures.values()].reduce((a, b) => a + b, 0)}`);
for (const [message, count] of failures) console.log(`  ${count}x ${message}`);
