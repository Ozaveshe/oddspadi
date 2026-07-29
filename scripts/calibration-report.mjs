#!/usr/bin/env node
/**
 * Per-sport calibration report: reliability buckets, expected calibration
 * error, Brier score and Brier skill against the base rate.
 *
 *   node scripts/calibration-report.mjs             # every sport
 *   node scripts/calibration-report.mjs --sport tennis
 *   node scripts/calibration-report.mjs --days 30
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
 */
import { createClient } from "@supabase/supabase-js";

function arg(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}

const days = Number(arg("days", "45"));
const sportFilter = arg("sport");
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

async function settledRows(sport) {
  // Only settled markets carry a truth value to calibrate against.
  const { data, error } = await client
    .from("op_market_decisions")
    .select("model_probability,settlement_result,fixture_id,op_fixtures!inner(sport)")
    .eq("op_fixtures.sport", sport)
    .not("model_probability", "is", null)
    .not("settlement_result", "is", null)
    .gte("generated_at", new Date(Date.now() - days * 86_400_000).toISOString())
    .limit(50_000);
  if (error) throw new Error(error.message);
  return (data ?? [])
    .map((row) => ({ p: Number(row.model_probability), won: row.settlement_result === "won" ? 1 : 0 }))
    .filter((row) => Number.isFinite(row.p) && row.p >= 0 && row.p <= 1);
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
  const report = summarise(rows);
  console.log(`\n${sport.toUpperCase()} — last ${days} days`);
  if (!report) {
    console.log("  No settled decisions with model probabilities. Nothing can be calibrated, and nothing should publish.");
    continue;
  }
  anyMeasured = true;
  const verdict = report.brierSkill > 0 ? "beats the base rate" : "WORSE than the base rate";
  console.log(`  settled=${report.n}  baseRate=${report.baseRate.toFixed(3)}`);
  console.log(`  Brier=${report.brier.toFixed(4)}  reference=${report.referenceBrier.toFixed(4)}  skill=${report.brierSkill.toFixed(4)}  (${verdict})`);
  console.log(`  ECE=${report.ece.toFixed(4)}  ${report.ece > 0.1 ? "(exceeds the 0.10 trust threshold)" : "(within the 0.10 trust threshold)"}`);
  console.log("  reliability:");
  for (const bucket of report.buckets) {
    const flag = Math.abs(bucket.gap) > 0.15 ? "  <-- large gap" : "";
    console.log(`    ${bucket.label}  n=${String(bucket.n).padStart(5)}  predicted=${bucket.predicted.toFixed(3)}  actual=${bucket.actual.toFixed(3)}  gap=${bucket.gap >= 0 ? "+" : ""}${bucket.gap.toFixed(3)}${flag}`);
  }
}

if (!anyMeasured) process.exitCode = 3;
