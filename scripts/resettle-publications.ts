#!/usr/bin/env node
/**
 * Re-grade settled claims under the canonical rules.
 *
 *   npm run ops:resettle              # dry run — reports, writes nothing
 *   npm run ops:resettle -- --commit  # writes corrections
 *
 * Dry run is the default and `--commit` is required, because this changes a
 * public record. A verdict already shown to a reader is not a row to be
 * quietly improved: correcting one is a deliberate act, and the diff exists to
 * be read before it happens rather than explained afterwards.
 *
 * Exit codes follow the reconcile-truth contract:
 *
 *   0  nothing to change, or a commit that succeeded
 *   1  a dry run found verdicts that would move — read them, then decide
 *   2  could not complete
 */
import { runResettle } from "@/lib/publication/resettle";

const commit = process.argv.includes("--commit");
const limitArg = process.argv.find((argument) => argument.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : 500;

const run = await runResettle({ persist: commit, limit: Number.isFinite(limit) ? limit : 500 });

if (run.status === "unavailable" || run.status === "not-migrated") {
  console.error("COULD NOT COMPLETE");
  for (const error of run.errors) console.error(`  ${error}`);
  process.exit(2);
}

console.log(commit ? "COMMITTED" : "DRY RUN — nothing written");
console.log(
  `  examined ${run.totals.examined}  unchanged ${run.totals.unchanged}  changed ${run.totals.changed}  ` +
    `ungradeable ${run.totals.ungradeable}  awaiting result ${run.totals.awaitingResult}  failed ${run.totals.failed}`
);

if (Object.keys(run.transitions).length) {
  console.log("\nTransitions");
  for (const [transition, count] of Object.entries(run.transitions).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${transition.padEnd(22)} ${count}`);
  }
}

if (run.changes.length) {
  console.log("\nClaims that would change" + (commit ? " (written)" : ""));
  for (const change of run.changes.slice(0, 50)) {
    console.log(
      `  ${change.kickoffAt.slice(0, 10)}  ${change.sport.padEnd(10)} ${change.market}/${change.selection}` +
        `  ${change.from} → ${change.to}`
    );
    console.log(`      ${change.marketKey} ${change.ruleVersion} on ${change.basis}`);
    console.log(`      ${change.reason}`);
  }
  if (run.changes.length > 50) {
    // Never a silent truncation: a capped list that does not say it is capped
    // reads as the whole set.
    console.log(`  … and ${run.changes.length - 50} more not shown. Raise --limit or re-run after committing these.`);
  }
}

if (run.errors.length) {
  console.log("\nErrors");
  for (const error of run.errors) console.log(`  ${error}`);
}

if (!commit && run.totals.changed > 0) {
  console.log(
    `\n${run.totals.changed} verdict(s) would change. These are corrections to a public record.\n` +
      "Read the transitions above, then re-run with --commit if they are right."
  );
}

process.exit(run.errors.length ? 2 : !commit && run.totals.changed > 0 ? 1 : 0);
