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
 * cannot see and which happened here: migrations applied through the MCP
 * path, which assigns its own version at apply time (`20260803114025`)
 * rather than using the filename (`20260803120000`). The schema was right
 * and the ledger was right about what ran, but they did not refer to the
 * same things.
 *
 * The two version sets must match in **both** directions, because that is
 * what `supabase db push` compares:
 *
 *   file with no ledger row  -> it re-runs on a fresh push
 *   ledger row with no file  -> push refuses outright, "Remote migration
 *                               versions not found in local migrations
 *                               directory"
 *
 * The second direction used to be reported and not failed on. That left this
 * check green while the Supabase Preview check on `main` was red for the same
 * repository state — a check that cannot fail cannot warn, so it was worse
 * than no check. Both directions fail now.
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
  // Ledger rows with no file. These were treated as harmless history for a
  // while, on the grounds that the MCP path records each apply under its own
  // version and an iterative fix folded into one committed file leaves its
  // intermediate steps behind. That reasoning was right about the cause and
  // wrong about the consequence: `supabase db push` compares the two version
  // *sets*, and refuses on any remote version it cannot find locally —
  // "Remote migration versions not found in local migrations directory".
  //
  // So this check passed while the Supabase Preview check on `main` failed,
  // which is the worst of the two states: a green local check that certifies
  // nothing. Both directions fail here now.
  //
  // The fix for a row in this direction is a file at that exact version. Where
  // the step was folded into a later committed file, that file carries no
  // statements and says so — it exists to hold the version. Do not replay the
  // recovered SQL: MCP versions interleave *before* the consolidated files
  // that create the objects they depend on, so a replay builds in an order
  // that never ran and would fail on a fresh push.
  const ledgerOnly = [...applied].filter((version) => !files.some((file) => file.startsWith(version)));
  console.log(`ledger: ${applied.size} applied, ${files.length} file(s), ${ledgerOnly.length} row(s) with no file`);
  if (unapplied.length) {
    problems.push(
      `${unapplied.length} migration file(s) are not recorded as applied and would re-run on push: ${unapplied.join(", ")}`
    );
  }
  if (ledgerOnly.length) {
    problems.push(
      `${ledgerOnly.length} applied version(s) have no file, so \`supabase db push\` will refuse ` +
        `("Remote migration versions not found in local migrations directory"): ${ledgerOnly.join(", ")}. ` +
        `Commit a file named <version>_<name>.sql for each — empty, documenting what ran and which ` +
        `committed file superseded it, if the change is already carried elsewhere. ` +
        `Never delete the ledger row. See docs/migration-ledger.md.`
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
  // `process.exitCode`, not `process.exit()`. Calling `process.exit()` while
  // the supabase-js client still holds open sockets aborts Node's teardown on
  // Windows with a libuv assertion (`!(handle->flags & UV_HANDLE_CLOSING)`),
  // which replaces the intended exit code 1 with 127. Non-zero either way, so
  // CI still fails — but a check that exists to report a specific failure
  // should not report it as a crash. Setting the code and falling off the end
  // lets the client close first.
  process.exitCode = 1;
} else {
  console.log("migration ordering and ledger immutability OK");
}
