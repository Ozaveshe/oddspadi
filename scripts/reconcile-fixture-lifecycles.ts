#!/usr/bin/env node
/**
 * Preview or commit a fixture lifecycle reconciliation.
 *
 * Previews by default. `--commit` is the only way to write, because a job that
 * quarantines fixtures should never be one keystroke away from running by
 * accident.
 *
 *   npm run ops:reconcile-lifecycles
 *   npm run ops:reconcile-lifecycles -- --commit
 *
 * Runs through vite-node because it imports the same `fixtureLifecycle` the
 * pages use. Re-implementing the rule here in plain JS would give the sweep its
 * own copy of the policy, which is the drift this whole change removes.
 */
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

// Loaded here rather than via `node --env-file`, because this runs through
// vite-node (to resolve `@/`) and so does not get node's own env-file flag.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
} catch {
  // Absent in CI and in production, where the environment is already set.
}

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Needs SUPABASE_URL and SUPABASE_SECRET_KEY.");
  process.exit(2);
}

const commit = process.argv.includes("--commit");
const client = createClient(url, key, { auth: { persistSession: false } });

const { reconcileFixtureLifecycles } = await import("@/lib/sports/lifecycle/reconcile");
const report = await reconcileFixtureLifecycles({ commit, client });

console.log(`${report.status} — scanned ${report.scanned}, ${report.changes.length} change(s)`);
for (const row of report.bySport) {
  console.log(`  ${row.sport.padEnd(12)} scanned ${String(row.scanned).padStart(4)}  changed ${row.changed}`);
}

const byTransition = new Map<string, number>();
for (const change of report.changes) {
  const label = `${change.from} -> ${change.to} (${change.basis})`;
  byTransition.set(label, (byTransition.get(label) ?? 0) + 1);
}
for (const [label, count] of [...byTransition].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${label}`);
}

for (const error of report.errors) console.error(`  error: ${error}`);
if (!commit) console.log("\nPreview only. Re-run with --commit to write.");
process.exit(report.errors.length ? 1 : 0);
