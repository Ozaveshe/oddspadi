#!/usr/bin/env node
/**
 * The release gate. One command, and it says what it did not check.
 *
 *   npm run gate:release            all stages that need no credentials
 *   npm run gate:release -- --full  plus the stages that reach production
 *
 * The design constraint is that a gate which silently skips a stage is worse
 * than no gate: it produces a green result that nobody can interpret. So every
 * stage reports one of PASS / FAIL / SKIPPED-with-a-reason, and the summary
 * lists the skips as prominently as the failures.
 *
 * Exit codes: 0 all attempted stages passed, 1 a stage failed.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

const full = process.argv.includes("--full");
const hasDbCredentials = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);

/**
 * @type {Array<{name: string, why: string, cmd: string[] | null, skip?: string}>}
 */
const STAGES = [
  {
    name: "typecheck",
    why: "Two passes: the app and the test project have separate configs.",
    cmd: ["npm", "run", "typecheck"]
  },
  {
    name: "unit + domain contracts",
    why: "Includes the state matrix and the coherence model.",
    cmd: ["npx", "vitest", "run"]
  },
  {
    name: "state matrix doc is current",
    why: "The doc is generated; a stale checked-in copy documents a product that no longer exists.",
    cmd: ["node", "scripts/check-generated-docs.mjs"]
  },
  {
    name: "migration validation",
    why: "Every migration must be forward-only and named in sequence.",
    cmd: existsSync("supabase/migrations") ? ["node", "scripts/check-migrations.mjs"] : null,
    skip: "no supabase/migrations directory"
  },
  {
    name: "build",
    why: "A type-clean app can still fail to build.",
    cmd: ["npm", "run", "build"]
  },
  {
    name: "production reconciliation",
    why: "Cross-surface truth against live data.",
    cmd: full && hasDbCredentials ? ["npm", "run", "ops:reconcile-truth"] : null,
    skip: full ? "SUPABASE_SECRET_KEY not set" : "run with --full"
  },
  {
    name: "production smoke",
    why: "The deployed site answers and does not leak.",
    cmd: full ? ["npm", "run", "ops:health"] : null,
    skip: "run with --full"
  }
];

/** Stages the brief requires that this repository cannot yet run. */
const NOT_IMPLEMENTED = [
  ["end-to-end tests", "no browser driver is installed; the suite renders components, not navigated routes"],
  ["accessibility checks", "no automated axe run exists in CI"],
  ["visual regression", "no snapshot baseline exists"],
  ["performance budget", "scripts/load-test-public-reads.mjs measures, but no threshold fails a build"]
];

const results = [];
for (const stage of STAGES) {
  if (!stage.cmd) {
    results.push({ ...stage, status: "SKIPPED" });
    continue;
  }
  process.stdout.write(`\n=== ${stage.name} ===\n`);
  const [command, ...args] = stage.cmd;
  const run = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  results.push({ ...stage, status: run.status === 0 ? "PASS" : "FAIL" });
}

console.log("\n" + "=".repeat(64));
console.log("RELEASE GATE");
console.log("=".repeat(64));
for (const result of results) {
  const detail = result.status === "SKIPPED" ? `  (${result.skip})` : "";
  console.log(`  ${result.status.padEnd(8)} ${result.name}${detail}`);
}

console.log("\nNOT CHECKED BY THIS GATE — these are gaps, not passes:");
for (const [name, reason] of NOT_IMPLEMENTED) console.log(`  ${name} — ${reason}`);

const failed = results.filter((r) => r.status === "FAIL");
const skipped = results.filter((r) => r.status === "SKIPPED");
console.log(
  `\n${results.filter((r) => r.status === "PASS").length} passed, ${failed.length} failed, ${skipped.length} skipped, ` +
    `${NOT_IMPLEMENTED.length} not implemented`
);
process.exit(failed.length ? 1 : 0);
