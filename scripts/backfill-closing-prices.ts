#!/usr/bin/env node
/**
 * Capture closing prices for published claims that do not yet have one.
 *
 *   npm run ops:closing-prices              # dry run — reports, writes nothing
 *   npm run ops:closing-prices -- --commit  # writes captures and misses
 *
 * Dry run is the default. This writes the evidence a public CLV figure is
 * computed from, and the coverage split is meant to be read before it lands
 * rather than explained afterwards.
 *
 * Note what "coverage" means here, because it is easy to misread: an absent
 * close is a successful outcome of this sweep, not a failure of it. A claim
 * nobody priced deeply enough gets a row saying so, with the reason. The
 * failure mode being designed out is the opposite one — a gap that later reads
 * as a zero and quietly drags a CLV average toward the middle.
 *
 * Exit codes:
 *
 *   0  completed (or a dry run with nothing alarming)
 *   1  completed with per-row errors — read them
 *   2  could not complete
 */
import { runClosingCapture } from "@/lib/closing/captureSweep";
import type { CaptureStatus } from "@/lib/closing/policy";

const commit = process.argv.includes("--commit");
const limitArg = process.argv.find((argument) => argument.startsWith("--limit="));
const parsedLimit = limitArg ? Number(limitArg.split("=")[1]) : 1000;
const limit = Number.isFinite(parsedLimit) ? parsedLimit : 1000;

const run = await runClosingCapture({ persist: commit, limit });

if (run.status === "unavailable" || run.status === "not-migrated") {
  console.error("COULD NOT COMPLETE");
  for (const error of run.errors) console.error(`  ${error}`);
  process.exit(2);
}

console.log(commit ? "COMMITTED" : "DRY RUN — nothing written");
console.log(
  `  eligible ${run.totals.eligible}  captured ${run.totals.captured}  absent ${run.totals.absent}  failed ${run.totals.failed}`
);

const coverage = run.totals.eligible ? run.totals.captured / run.totals.eligible : 0;
console.log(`  coverage ${(coverage * 100).toFixed(1)}% of the claims examined this run`);

const absent = (Object.entries(run.byStatus) as Array<[CaptureStatus, number]>)
  .filter(([status, count]) => status !== "captured" && count > 0)
  .sort((left, right) => right[1] - left[1]);

if (absent.length) {
  console.log("\nWhy a close is absent");
  for (const [status, count] of absent) console.log(`  ${status.padEnd(22)} ${count}`);
}

if (run.errors.length) {
  console.log("\nErrors");
  for (const error of run.errors) console.log(`  ${error}`);
  process.exit(1);
}

process.exit(0);
