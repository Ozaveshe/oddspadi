#!/usr/bin/env node
/**
 * Which gate is actually stopping publication?
 *
 *   node --env-file-if-exists=.env.local scripts/diagnose-publication-blockers.mjs [--hours 12]
 *
 * The engine applies a chain of vetoes on top of the numeric edge thresholds.
 * Any one of them can zero the whole slate, and nothing reported which one
 * fired — so "everything is blocked" looked like one mysterious switch rather
 * than several rules with separate justifications. Measured on 2026-08-03,
 * 7,793 decisions cleared the numeric gate and not one became a value pick.
 *
 * Every decision already records why it landed where it did. This counts them.
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

const hoursArg = Number(process.argv[process.argv.indexOf("--hours") + 1]);
const hours = Number.isFinite(hoursArg) && hoursArg > 0 ? hoursArg : 12;
const since = new Date(Date.now() - hours * 3_600_000).toISOString();

/**
 * Keyset by generated_at over `op_market_decisions`.
 *
 * `op_fixture_decision_summaries` is the richer source but cannot be read this
 * way: 700k rows, no index leading with `generated_at`, two large JSON columns
 * per row, and the ordered scan trips the 8s statement timeout before the first
 * page returns. `op_market_decisions` carries the per-selection `reason` — the
 * blocker text — and pages cheaply.
 */
async function readDecisions(limit) {
  const rows = [];
  let cursor = null;
  while (rows.length < limit) {
    let query = db
      .from("op_market_decisions")
      .select("sport,market,public_status,decision_status,reason,value_edge,expected_value,confidence,risk,evidence_quality,data_quality,generated_at")
      .gte("generated_at", since)
      .order("generated_at", { ascending: false })
      .limit(1000);
    if (cursor) query = query.lt("generated_at", cursor);
    const { data, error } = await query;
    if (error) throw new Error(`op_market_decisions: ${error.message}`);
    if (!data?.length) break;
    rows.push(...data);
    const last = data[data.length - 1].generated_at;
    if (last === cursor) break;
    cursor = last;
    if (data.length < 1000) break;
  }
  return rows;
}

/** Group specifics ("engine action is avoid") into the rule behind them. */
function ruleOf(reason) {
  const text = String(reason ?? "").toLowerCase();
  if (!text) return "(no reason recorded)";
  if (text.includes("no settled outcomes exist")) return "unproven-sport: no settled outcomes for this sport";
  if (text.includes("holdout yield")) return "governed-holdout: yield not positive";
  if (text.includes("closing-line value")) return "governed-holdout: CLV not positive";
  if (text.includes("engine action is")) return `engine-action: ${text.split("engine action is ")[1] ?? "?"}`;
  if (text.includes("calibration requires abstention")) return "calibration: abstain";
  if (text.includes("actionability is")) return `actionability: ${text.split("actionability is ")[1] ?? "?"}`;
  if (text.includes("abstention rule")) return "abstention rule active";
  if (text.includes("required production evidence")) return "data-coverage: required evidence missing/stale/mock";
  if (text.includes("fragile")) return "robustness: fragile";
  if (text.includes("high-risk")) return "uncertainty: high-risk";
  if (text.includes("raw edge") || text.includes("raw ev")) return "threshold: below uncalibrated edge/EV floor";
  if (text.includes("publication range")) return "threshold: odds outside publication range";
  if (text.includes("stale") || text.includes("expired")) return "odds stale or expired";
  if (text.includes("kickoff")) return "kickoff lead too short";
  if (text.includes("data quality")) return "data quality below floor";
  if (text.includes("consensus") || text.includes("bookmaker")) return "insufficient bookmaker consensus";
  if (text.includes("calibration profile")) return "no promoted calibration profile";
  return text.slice(0, 72);
}

const decisions = await readDecisions(60_000);
console.log(`Market decisions in the last ${hours}h: ${decisions.length}\n`);

const pct = (n, d) => (d ? `${((n / d) * 100).toFixed(1)}%` : "n/a");

const reasons = new Map();
const statuses = new Map();
const bySport = new Map();
const blockedButQualified = new Map();
let positiveEdge = 0;
let clearsUncalibrated = 0;

for (const row of decisions) {
  statuses.set(row.public_status, (statuses.get(row.public_status) ?? 0) + 1);
  const rule = ruleOf(row.reason);
  reasons.set(rule, (reasons.get(rule) ?? 0) + 1);

  const sportMap = bySport.get(row.sport) ?? new Map();
  sportMap.set(rule, (sportMap.get(rule) ?? 0) + 1);
  bySport.set(row.sport, sportMap);

  const edge = Number(row.value_edge);
  const ev = Number(row.expected_value);
  if (Number.isFinite(edge) && edge > 0) positiveEdge += 1;
  // The population that matters: numerically good enough to publish, yet not
  // published. Whatever stops these is the launch blocker.
  if (edge >= 0.05 && ev >= 0.04) {
    clearsUncalibrated += 1;
    if (row.public_status !== "value_pick") {
      blockedButQualified.set(rule, (blockedButQualified.get(rule) ?? 0) + 1);
    }
  }
}

console.log("public_status:", JSON.stringify(Object.fromEntries(statuses)));
console.log(`positive edge            : ${positiveEdge} (${pct(positiveEdge, decisions.length)})`);
console.log(`clears uncalibrated gate : ${clearsUncalibrated} (${pct(clearsUncalibrated, decisions.length)})`);

function table(title, map, denominator, limit = 14) {
  console.log(`\n${title}`);
  const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length) {
    console.log("  (none)");
    return;
  }
  for (const [rule, count] of sorted.slice(0, limit)) {
    console.log(`  ${String(count).padStart(7)}  ${pct(count, denominator).padStart(6)}  ${rule}`);
  }
}

table(
  `*** QUALIFIED ON THE NUMBERS BUT NOT PUBLISHED (n=${clearsUncalibrated}) ***`,
  blockedButQualified,
  clearsUncalibrated
);
table(`ALL DECISIONS BY REASON (n=${decisions.length})`, reasons, decisions.length);

for (const [sport, map] of bySport) {
  const total = [...map.values()].reduce((n, v) => n + v, 0);
  table(`${sport} (n=${total})`, map, total, 6);
}

console.log("\n--- reading this ---");
console.log("A reason at ~100% of the qualified population is a slate-wide veto: no amount");
console.log("of edge overcomes it, so tuning thresholds changes nothing until it is fixed.");
console.log("Reasons spread across the population are per-selection and behave sensibly.");
