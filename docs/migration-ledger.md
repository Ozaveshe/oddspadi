# Migration ledger

How `supabase/migrations/*.sql` and `supabase_migrations.schema_migrations`
stay in agreement, and what happens when they do not.

## The drift

Applying a migration through the Supabase MCP tool assigns its **own** version
at apply time. A file committed as `20260803120000_stale_fixture_status.sql`
gets recorded as `20260803114025 stale_fixture_status`. Same SQL, same
resulting schema, different version — and the version is the only thing a
`supabase db push` compares.

Measured 2026-08-06: **13 committed migrations had no matching ledger row.**
Eleven from 2026-08-03, one from 2026-07-28, and one duplicate file (below).
Production was correct throughout — every object those files describe existed —
but a push against a fresh environment would have re-run all thirteen.

Nothing could have caught it. `scripts/check-migrations.mjs` lints filenames
and never connected to a database, and `supabase_migrations` is not exposed
through PostgREST, so no script could read the ledger to compare.

## How it is checked now

```bash
npm run check:migrations          # filenames, ordering, destructive statements
npm run check:migrations:ledger   # the above, plus a comparison against the DB
```

The `--ledger` pass reads `op_applied_migration_versions()`, a `security
definer` function revoked from `anon` and `authenticated` — migration history
is operator information, not a public listing of every schema change and its
date. It **fails** when a committed file is not recorded as applied, because
that file would re-run.

It **reports but does not fail** on ledger rows with no file. Those are
expected: the MCP path records every apply, so an iterative fix that was later
folded into one committed file leaves its intermediate steps behind. 19 such
rows exist. They are real history and are deliberately kept.

## Reconciling

When the check reports unapplied files:

1. **Verify the schema first.** Query for the objects each file creates. Only
   record a migration as applied once you have confirmed it actually ran —
   marking an unrun migration applied hides it forever.
2. Insert the row with `created_by = 'repo-reconcile'`, which distinguishes a
   reconciliation from a genuine apply:

```sql
insert into supabase_migrations.schema_migrations (version, name, created_by)
values ('20260803120000','stale_fixture_status','repo-reconcile')
on conflict (version) do nothing;
```

`statements` is left null on purpose. The SQL that ran is already recorded
against the MCP-assigned row; duplicating it would imply this row executed
something, which it did not.

## Duplicate files

`20260730160000_prune_stale_odds.sql` was byte-identical to
`20260730155926_prune_stale_odds.sql`, which was the applied one. Two files
with the same content and different timestamps mean the second silently
re-runs the first. Removed. The filename lint checks ordering but not content,
so the ledger pass is what surfaced it.

## Avoiding the drift

Prefer `supabase db push` for schema changes, so the filename *is* the version.
When MCP `apply_migration` is the practical choice — iterating on a function
body against production, as happened throughout 2026-08-03 — commit the
consolidated file afterwards and run `npm run check:migrations:ledger` before
opening the PR.
