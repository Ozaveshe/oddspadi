#!/usr/bin/env node
/**
 * Per-sport calibration report: reliability buckets, expected calibration
 * error, Brier score, Brier skill against the base rate, and the market-anchor
 * diagnostics that say whether a model is tracking the market at all.
 *
 *   node scripts/calibration-report.mjs             # every sport
 *   node scripts/calibration-report.mjs --sport tennis
 *   node scripts/calibration-report.mjs --days 30
 *   node scripts/calibration-report.mjs --raw       # also show the row-level view
 *
 * The engine's own promotion gate reports these numbers, but only for a
 * candidate that has already been generated — which meant a sport with no
 * candidates at all (tennis) was invisible. This reads settled decisions
 * directly, so every sport can be measured whether or not it has ever produced
 * a calibration candidate.
 *
 * Brier skill is the number that matters: it compares the model against simply
 * predicting the base rate. Negative means the model is worse than that
 * baseline and has no business publishing.
 *
 * Three things this reports that earlier versions did not, each because their
 * absence produced a confidently wrong read:
 *
 * 1. UNIQUE PREDICTIONS, not rows. `op_market_decisions` holds several
 *    non-superseded rows per (fixture, market, selection) — football about 7x,
 *    tennis about 70x. Counting rows inflated football's sample to 2,296 when it
 *    was 313 predictions over 103 matches, and made tennis look like 10,261
 *    observations of 73 matches. It also skewed the point estimates: football
 *    reads +0.0052 skill per row and +0.1440 per unique prediction, because the
 *    duplicates are weighted toward earlier, worse decisions.
 *
 * 2. AN INTERVAL, clustered by fixture. A skill number with no error bar invites
 *    promoting on noise — exactly what the retired -0.368 figure did on an
 *    18-sample candidate. Resampling has to draw whole fixtures rather than
 *    individual predictions: the home and away calls on one match share an
 *    outcome, so treating them as independent would understate the interval.
 *
 * 3. MARKET ANCHORING. `corr(model, market)` is what exposed tennis: 0.97 for
 *    football against 0.05 for tennis, meaning the tennis model is not anchored
 *    to the price at all and its -0.08 skill is noise rather than a signal
 *    pointing the wrong way. No calibration curve shows that.
 */
import { createClient } from "@supabase/supabase-js";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}
const showRaw = process.argv.includes("--raw");

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}

const days = Number(arg("days", "45"));
const sportFilter = arg("sport");
const bootstrapSamples = Number(arg("bootstrap", "2000"));
const client = createClient(url, key, { auth: { persistSession: false } });

const BUCKETS = [[0, 0.1], [0.1, 0.2], [0.2, 0.3], [0.3, 0.4], [0.4, 0.5], [0.5, 0.6], [0.6, 0.7], [0.7, 0.8], [0.8, 0.9], [0.9, 1.01]];

function summarise(rows) {
  const n = rows.length;
  if (!n) return null;
  const baseRate = rows.reduce((sum, row) => sum + row.won, 0) / n;
  const brier = rows.reduce((sum, row) => sum + (row.p - row.won) ** 2, 0) / n;
  // Reference model: always predict the observed base rate.
  const referenceBrier = rows.reduce((sum, row) => sum + (baseRate - row.won) ** 2, 0) / n;
  const brierSkill = referenceBrier > 0 ? 1 - brier / referenceBrier : 0;

  const buckets = BUCKETS.map(([low, high]) => {
    const inBucket = rows.filter((row) => row.p >= low && row.p < high);
    if (!inBucket.length) return null;
    const predicted = inBucket.reduce((sum, row) => sum + row.p, 0) / inBucket.length;
    const actual = inBucket.reduce((sum, row) => sum + row.won, 0) / inBucket.length;
    return { label: `${low.toFixed(1)}-${Math.min(high, 1).toFixed(1)}`, n: inBucket.length, predicted, actual, gap: predicted - actual };
  }).filter(Boolean);

  // Expected calibration error: sample-weighted mean |predicted - actual|.
  const ece = buckets.reduce((sum, bucket) => sum + (bucket.n / n) * Math.abs(bucket.gap), 0);
  return { n, baseRate, brier, referenceBrier, brierSkill, ece, buckets };
}

function correlation(pairs) {
  const usable = pairs.filter(([left, right]) => Number.isFinite(left) && Number.isFinite(right));
  if (usable.length < 3) return null;
  const meanLeft = usable.reduce((sum, [left]) => sum + left, 0) / usable.length;
  const meanRight = usable.reduce((sum, [, right]) => sum + right, 0) / usable.length;
  let covariance = 0;
  let varianceLeft = 0;
  let varianceRight = 0;
  for (const [left, right] of usable) {
    covariance += (left - meanLeft) * (right - meanRight);
    varianceLeft += (left - meanLeft) ** 2;
    varianceRight += (right - meanRight) ** 2;
  }
  if (varianceLeft <= 0 || varianceRight <= 0) return null;
  return covariance / Math.sqrt(varianceLeft * varianceRight);
}

// Seeded so a report is reproducible; an ops number that moves between identical
// runs is a number nobody trusts.
function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 95% interval for Brier skill, resampling whole fixtures with replacement.
 * Clustered because predictions on one match are not independent observations.
 */
function brierSkillInterval(rows, samples) {
  const byFixture = new Map();
  for (const row of rows) {
    if (!byFixture.has(row.fixtureId)) byFixture.set(row.fixtureId, []);
    byFixture.get(row.fixtureId).push(row);
  }
  const clusters = [...byFixture.values()];
  if (clusters.length < 5 || samples < 50) return null;
  const random = mulberry32(0x0dd5_9ad1);
  const skills = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const drawn = [];
    for (let index = 0; index < clusters.length; index += 1) {
      drawn.push(...clusters[Math.floor(random() * clusters.length)]);
    }
    const summary = summarise(drawn);
    if (summary && Number.isFinite(summary.brierSkill)) skills.push(summary.brierSkill);
  }
  if (skills.length < samples / 2) return null;
  skills.sort((left, right) => left - right);
  const at = (quantile) => skills[Math.min(skills.length - 1, Math.max(0, Math.floor(quantile * skills.length)))];
  return { lower: at(0.025), upper: at(0.975), fixtures: clusters.length };
}

async function settledRows(sport) {
  // Only settled markets carry a truth value to calibrate against.
  //
  // The column is `settlement_status`; this asked for `settlement_result`,
  // which has never existed, so every sport fell into the catch below and the
  // report printed "could not read settled decisions" no matter what was in the
  // table. Filtering to won/lost matters just as much: the column is never
  // null (it defaults to 'pending'), so a not-null filter admits everything and
  // scores every unsettled row as a loss. void and push carry no truth value
  // either — a decision that never resolved is not a decision the model got
  // wrong.
  //
  // Paginate. PostgREST caps a response at its `max-rows` setting (1000 here)
  // and `.limit(50_000)` does not raise that ceiling — it silently returns the
  // first page. Worse, the rows are not randomly ordered, so the truncated
  // slice is biased: tennis came back as 1000 straight wins, a base rate of
  // 1.000 and therefore a reference Brier of 0, which forced Brier skill to a
  // meaningless 0.0000. An ordered full sweep is the only honest read.
  // Keyset, not offset: a growing OFFSET made Postgres re-sort the whole join
  // every page and the football sweep died on `statement timeout`. Walking the
  // primary key forward stays on the index.
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const pageSize = 1000;
  const rows = [];
  let cursor = "00000000-0000-0000-0000-000000000000";
  for (;;) {
    const { data, error } = await client
      .from("op_market_decisions")
      // Filter on the decision's own `sport` rather than joining op_fixtures.
      // The embedded inner join forced a join before the keyset predicate could
      // narrow anything and the football sweep died on `statement timeout`.
      // Verified safe across all 387,721 rows: `sport` is never null and never
      // disagrees with its fixture.
      .select("id,fixture_id,market,selection,model_probability,no_vig_probability,implied_probability,settlement_status,generated_at")
      .eq("sport", sport)
      .not("model_probability", "is", null)
      .in("settlement_status", ["won", "lost"])
      .is("superseded_by", null)
      .gte("generated_at", since)
      .gt("id", cursor)
      .order("id", { ascending: true })
      .limit(pageSize);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) break;
    cursor = data[data.length - 1].id;
  }
  return rows
    .map((row) => ({
      key: `${row.fixture_id}|${row.market}|${row.selection}`,
      fixtureId: String(row.fixture_id),
      generatedAt: String(row.generated_at),
      p: Number(row.model_probability),
      market: Number(row.no_vig_probability ?? row.implied_probability),
      won: row.settlement_status === "won" ? 1 : 0
    }))
    .filter((row) => Number.isFinite(row.p) && row.p >= 0 && row.p <= 1);
}

/** Latest decision per (fixture, market, selection) — the engine's final call. */
function uniquePredictions(rows) {
  const latest = new Map();
  for (const row of rows) {
    const held = latest.get(row.key);
    if (!held || row.generatedAt > held.generatedAt) latest.set(row.key, row);
  }
  return [...latest.values()];
}

const sports = sportFilter ? [sportFilter] : ["football", "basketball", "tennis"];
let anyMeasured = false;

for (const sport of sports) {
  let rows = [];
  try {
    rows = await settledRows(sport);
  } catch (error) {
    console.log(`\n${sport.toUpperCase()}: could not read settled decisions — ${error.message}`);
    continue;
  }
  const unique = uniquePredictions(rows);
  const report = summarise(unique);
  const rawReport = summarise(rows);
  console.log(`\n${sport.toUpperCase()} — last ${days} days`);
  if (!report) {
    console.log("  No settled decisions with model probabilities. Nothing can be calibrated, and nothing should publish.");
    continue;
  }
  anyMeasured = true;
  const fixtures = new Set(unique.map((row) => row.fixtureId)).size;
  const duplication = unique.length ? rows.length / unique.length : 0;

  console.log(`  sample: ${unique.length} unique predictions over ${fixtures} matches` +
    `  (${rows.length} stored rows, ${duplication.toFixed(1)}x duplicated)`);
  console.log(`  baseRate=${report.baseRate.toFixed(3)}`);

  const verdict = report.brierSkill > 0 ? "beats the base rate" : "WORSE than the base rate";
  const interval = brierSkillInterval(unique, bootstrapSamples);
  const intervalText = interval
    ? `  95% CI [${interval.lower >= 0 ? "+" : ""}${interval.lower.toFixed(4)}, ${interval.upper >= 0 ? "+" : ""}${interval.upper.toFixed(4)}]`
    : "  (too few matches for an interval)";
  console.log(`  Brier=${report.brier.toFixed(4)}  reference=${report.referenceBrier.toFixed(4)}  skill=${report.brierSkill >= 0 ? "+" : ""}${report.brierSkill.toFixed(4)}  (${verdict})`);
  console.log(`  skill interval:${intervalText}`);
  if (interval && interval.lower <= 0 && interval.upper >= 0) {
    console.log("    interval spans zero — the skill is not distinguishable from guessing the base rate");
  }
  console.log(`  ECE=${report.ece.toFixed(4)}  ${report.ece > 0.1 ? "(exceeds the 0.10 trust threshold)" : "(within the 0.10 trust threshold)"}`);

  const modelVsOutcome = correlation(unique.map((row) => [row.p, row.won]));
  const marketVsOutcome = correlation(unique.map((row) => [row.market, row.won]));
  const modelVsMarket = correlation(unique.map((row) => [row.p, row.market]));
  const spread = Math.sqrt(unique.reduce((sum, row) => sum + (row.p - report.baseRate) ** 2, 0) / unique.length);
  const show = (value) => (value === null ? "n/a" : `${value >= 0 ? "+" : ""}${value.toFixed(4)}`);
  console.log("  market anchoring:");
  console.log(`    corr(model, outcome)=${show(modelVsOutcome)}   corr(market, outcome)=${show(marketVsOutcome)}`);
  console.log(`    corr(model, market)=${show(modelVsMarket)}    model spread=${spread.toFixed(4)}`);
  if (modelVsMarket !== null && modelVsMarket < 0.5) {
    console.log("    corr(model, market) is low — this sport is not anchored to the price it is");
    console.log("    being judged against, so its skill number describes noise, not a view");
  }

  if (showRaw && rawReport) {
    console.log(`  row-level view (duplicated, for comparison only): n=${rawReport.n}` +
      `  skill=${rawReport.brierSkill >= 0 ? "+" : ""}${rawReport.brierSkill.toFixed(4)}  ECE=${rawReport.ece.toFixed(4)}`);
  }

  console.log("  reliability (unique predictions):");
  for (const bucket of report.buckets) {
    const flag = Math.abs(bucket.gap) > 0.15 ? "  <-- large gap" : "";
    console.log(`    ${bucket.label}  n=${String(bucket.n).padStart(5)}  predicted=${bucket.predicted.toFixed(3)}  actual=${bucket.actual.toFixed(3)}  gap=${bucket.gap >= 0 ? "+" : ""}${bucket.gap.toFixed(3)}${flag}`);
  }
}

if (!anyMeasured) process.exitCode = 3;
