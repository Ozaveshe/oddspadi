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

It **also fails** when a ledger row has no file. It used only to report those,
on the grounds that they were expected MCP artefacts. That was right about the
cause and wrong about the consequence — see below.

## The other direction

Measured 2026-08-07: **23 ledger rows had no committed file.** `supabase db
push` compares the two version *sets* and refuses on any remote version it
cannot find locally:

```
Remote migration versions not found in local migrations directory.
```

So the Supabase Preview check on `main` had been failing on exactly the state
this document described as harmless, while `npm run check:migrations` passed.
A check that stays green when the thing it guards is broken is worse than no
check, because it is trusted. Both directions fail now.

All 23 were genuine superseded intermediates — steps of an iterative fix later
folded into one committed file. Each was confirmed against production before
being resolved: the live object matches the *committed* file, not the
intermediate. None was schema the repo had no record of.

### Resolve with an empty file, not a replay

The obvious fix — recover the SQL from `statements` and commit it under its own
version — is wrong here, and would have broken a fresh push.

MCP-assigned versions interleave *before* the consolidated files that create
the objects they depend on. `20260803145321 latest_odds_reads_current_projection`
reads `public.op_current_odds`; that table is created by
`20260803170000_current_odds_projection.sql`, a **later** version. Replaying it
in filename order would run against a table that does not exist yet. The same
holds for `20260803144750 backfill_current_odds_incremental`.

So a superseded intermediate gets a file at its exact version carrying **no
statements**, documenting what ran, which committed file superseded it, and
what was verified in production. It exists to hold the version. The ledger row
keeps the SQL that actually executed; the file does not duplicate it, because
that would imply this version executed something, which on a fresh environment
it does not.

Commit a *reproducing* file instead only when the ledger row is real schema no
committed file rebuilds — the dangerous case, and none of the 23 were it.

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
