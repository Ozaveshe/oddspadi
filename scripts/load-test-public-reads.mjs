#!/usr/bin/env node
/**
 * Load test for the public read path.
 *
 *   node --env-file-if-exists=.env.local scripts/load-test-public-reads.mjs
 *   ... --iterations 200 --concurrency 20 --compare
 *
 * Measures the projection read that public pages now use, and with --compare
 * also measures the raw operational query it replaced, so the improvement is
 * evidence rather than an assertion.
 *
 * This exercises the database path, which is where the timeouts were. It does
 * not measure Next rendering or CDN behaviour.
 */
import { createClient } from "@supabase/supabase-js";

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1] ?? fallback;
}
const iterations = Number(arg("iterations", "120"));
const concurrency = Number(arg("concurrency", "12"));
const compare = process.argv.includes("--compare");

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SECRET_KEY are required.");
  process.exit(1);
}
const client = createClient(url, key, { auth: { persistSession: false } });
const today = new Date().toISOString().slice(0, 10);

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(fraction * sorted.length) - 1));
  return sorted[index];
}

async function run(label, task) {
  const durations = [];
  let failures = 0;
  const queue = Array.from({ length: iterations }, (_, index) => index);

  async function worker() {
    for (;;) {
      if (!queue.length) return;
      queue.shift();
      const started = performance.now();
      try {
        const { error } = await task();
        if (error) failures += 1;
      } catch {
        failures += 1;
      }
      durations.push(performance.now() - started);
    }
  }

  const wallStart = performance.now();
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  const wallMs = performance.now() - wallStart;
  const sorted = [...durations].sort((left, right) => left - right);
  return {
    label,
    n: durations.length,
    failures,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    p99: percentile(sorted, 0.99),
    max: sorted.at(-1) ?? null,
    throughputPerSecond: (durations.length / wallMs) * 1000
  };
}

const results = [];

// The path public pages actually take: one primary-key lookup.
results.push(
  await run("projection read (public path)", () =>
    client
      .from("op_public_projections")
      .select("payload,row_count,source_max_at,built_at,builder_version,status,last_error")
      .eq("name", "daily_fixture_slate")
      .eq("scope", today)
      .maybeSingle()
  )
);

results.push(
  await run("live board projection", () =>
    client
      .from("op_public_projections")
      .select("payload,row_count,built_at,status")
      .eq("name", "live_fixture_board")
      .eq("scope", "")
      .maybeSingle()
  )
);

if (compare) {
  // The shape the public slate used to run per request: a join over the
  // 618k-row / 2.4 GB summary table filtered on superseded_by.
  results.push(
    await run("raw slate join (pre-projection path)", () =>
      client
        .from("op_fixture_decision_summaries")
        .select("fixture_id,public_status,generated_at,best_watchlist_candidate")
        .is("superseded_by", null)
        .order("generated_at", { ascending: false })
        .limit(200)
    )
  );
}

const pad = (value, width) => String(value).padEnd(width);
console.log(`\nload test · ${iterations} iterations · concurrency ${concurrency} · ${new Date().toISOString()}\n`);
console.log(`${pad("path", 40)} ${pad("n", 5)} ${pad("fail", 5)} ${pad("p50", 9)} ${pad("p95", 9)} ${pad("p99", 9)} ${pad("max", 9)} req/s`);
for (const result of results) {
  console.log(
    `${pad(result.label, 40)} ${pad(result.n, 5)} ${pad(result.failures, 5)} ` +
      `${pad(`${result.p50?.toFixed(1)}ms`, 9)} ${pad(`${result.p95?.toFixed(1)}ms`, 9)} ` +
      `${pad(`${result.p99?.toFixed(1)}ms`, 9)} ${pad(`${result.max?.toFixed(1)}ms`, 9)} ${result.throughputPerSecond.toFixed(1)}`
  );
}

const publicRead = results[0];
const BUDGET_MS = 800;
console.log(
  `\nbudget: public read p95 < ${BUDGET_MS}ms — ${publicRead.p95 !== null && publicRead.p95 < BUDGET_MS ? "MET" : "MISSED"} (${publicRead.p95?.toFixed(1)}ms)`
);
if (publicRead.failures) {
  console.error(`${publicRead.failures} public read(s) failed during the run.`);
  process.exitCode = 1;
}
