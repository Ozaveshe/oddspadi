#!/usr/bin/env node
/**
 * Migration validation.
 *
 * Migrations here are forward-only and applied in filename order, so the
 * filenames are the schedule. Two things go wrong with that in practice: a
 * timestamp that sorts before one already applied in production (it will be
 * skipped, silently), and a destructive statement shipped without the operator
 * knowing it is destructive.
 *
 * This checks both. By default it does not connect to a database — it is a
 * lint over the files, safe to run anywhere.
 *
 * With `--ledger` it also compares the filenames against what the database
 * says it has applied. That catches a third failure, which the file lint
 * cannot see and which happened here: eleven migrations were applied through
 * the MCP path, which assigns its own version at apply time
 * (`20260803114025`) rather than using the filename (`20260803120000`). The
 * schema was right and the ledger was right about what ran, but they did not
 * refer to the same things, so a `supabase db push` against a fresh
 * environment would have re-run all eleven.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = "supabase/migrations";
const files = readdirSync(DIR).filter((name) => name.endsWith(".sql")).sort();
const problems = [];

const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
let previous = null;
for (const file of files) {
  const match = NAME.exec(file);
  if (!match) {
    problems.push(`${file}: name must be <14-digit timestamp>_snake_case.sql`);
    continue;
  }
  if (previous && match[1] <= previous.stamp) {
    problems.push(`${file}: timestamp does not advance past ${previous.file}`);
  }
  previous = { stamp: match[1], file };
}

/**
 * Statements that cannot be undone by a later forward migration without data
 * loss. Allowed, but they must be announced so a reviewer sees them.
 */
const DESTRUCTIVE = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table\s+\S+\s+rename\b/i
];

/**
 * Everything except `$$ ... $$` function bodies.
 *
 * DML inside a function is the sanctioned path; DML in the migration body runs
 * once, unreviewed, against live history.
 */
function outsideFunctionBodies(sql) {
  return sql.replace(/\$\$[\s\S]*?\$\$/g, " ");
}

const destructive = [];
for (const file of files) {
  const sql = readFileSync(join(DIR, file), "utf8");
  // Strip line comments so a comment mentioning "drop table" is not a hit.
  const body = sql.replace(/--[^\n]*/g, "");
  for (const pattern of DESTRUCTIVE) {
    const hit = pattern.exec(body);
    if (hit) destructive.push(`${file}: ${hit[0].trim()}`);
  }
  // The ledger is append-only *from outside*. The sanctioned RPCs
  // (`op_correct_publication`, `op_settle_publication`) do update lifecycle
  // columns, and they write a revision row in the same transaction — that is
  // the design, not a violation. What must never appear is bare DML in a
  // migration body, which changes history with no revision behind it.
  if (/\b(update|delete\s+from)\s+public\.op_publications\b/i.test(outsideFunctionBodies(body))) {
    problems.push(`${file}: bare DML against op_publications outside a sanctioned function`);
  }
}

console.log(`checked ${files.length} migrations`);

// --ledger: compare filenames against the applied versions the database
// reports. Needs SUPABASE_SECRET_KEY; the RPC is revoked from anon.
if (process.argv.includes("--ledger")) {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error("--ledger needs SUPABASE_URL and SUPABASE_SECRET_KEY.");
    process.exit(2);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const db = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await db.rpc("op_applied_migration_versions");
  if (error) {
    console.error(`ledger read failed: ${error.message}`);
    process.exit(2);
  }
  const applied = new Set((data ?? []).map((row) => String(row.version)));
  const unapplied = files.map((file) => file.slice(0, 14)).filter((version) => !applied.has(version));
  // Ledger rows with no file are historical: the MCP path records each apply
  // under its own version, so an iterative fix that was later folded into one
  // committed file leaves extra rows behind. Harmless, and reported for
  // context rather than failed on.
  const ledgerOnly = [...applied].filter((version) => !files.some((file) => file.startsWith(version)));
  console.log(`ledger: ${applied.size} applied, ${ledgerOnly.length} historical row(s) with no file`);
  if (unapplied.length) {
    problems.push(
      `${unapplied.length} migration file(s) are not recorded as applied and would re-run on push: ${unapplied.join(", ")}`
    );
  }
}
if (destructive.length) {
  console.log(`\n${destructive.length} destructive statement(s) — confirm each is intended:`);
  for (const entry of destructive) console.log(`  ${entry}`);
}
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}
console.log("migration ordering and ledger immutability OK");
