# Applying the settlement and market-ontology migrations

Runbook for the eleven migrations added on
`claude/result-settlement-closing-price-5bdb1e`. None has run anywhere.

Read this once before starting. Step 2 is a sizing check that decides whether
step 4 is safe to run as written.

## What is being applied

| File | What it does | Risk |
|---|---|---|
| `20260807100000` | `op_canonical_markets` / `op_canonical_selections` | New tables |
| `20260807100100` | `line`, `snapshot_class`, `outlier_state` on `op_odds_snapshots` + **backfill** | **Largest table, unbatched UPDATE** |
| `20260807100200` | `op_fixture_results` | New table |
| `20260807100300` | `op_closing_prices`, `op_settlement_exceptions`, operator log | New tables |
| `20260807100400` | `op_market_aliases` + `btree_gist` + exclusion constraint | New extension |
| `20260807100500` | `half_won` / `half_lost` on two check constraints, 5 new columns | **Widens a live constraint** |
| `20260807100600` | Canonical mirror seed (upsert) | Data |
| `20260807100700` | `op_record_fixture_result()` | New function |
| `20260807100800` | `op_record_settlement_exception()` | New function |
| `20260807100900` | `op_closing_coverage()`, `op_closing_coverage_queue()` | New functions |
| `20260807101000` | `op_settle_publication()` **replaced** | **Changes a live function** |

Two are not additive: `100500` widens constraints on `op_publications` and
`op_publication_settlements`, and `101000` replaces a function the settlement
cron already calls. Both are backwards compatible — widening a check accepts
everything it accepted before, and the new function keeps the old signature —
but they are the two to read before running.

## Step 1 — Authorise and confirm the project

In an interactive `claude` session:

```
/mcp
```

Authorise `supabase_oddspadi`. Then, before any SQL, confirm you are pointed at
OddsPadi and not one of the other projects on the same account:

```
get_project_url
```

It must return `https://wncwtzqipnoqwmqlznqn.supabase.co`. If it returns
anything else, stop — `AGENTS.md` is explicit that a mismatched connector must
not mutate the database.

## Step 2 — Size the odds backfill before running it

`20260807100100` runs two unbatched `UPDATE`s over `op_odds_snapshots`. On a
table of a few hundred thousand rows that is seconds; on several million it is
a long transaction holding row locks on the table the live odds writer is
inserting into.

Run this first (read-only):

```sql
select
  count(*) filter (where market ~ 'over_under_[0-9]+$') as by_market,
  count(*) filter (where selection ~ '^(?:over|under)_[0-9]+$') as by_selection,
  count(*) as total
from public.op_odds_snapshots;
```

- **Under ~500k rows to update:** proceed as written.
- **Over that:** stop and say so. The backfill should be split into a batched
  function like `op_batch_prune_stale_odds` already is, rather than run as one
  statement. That is a change to the migration, and the migration has not run,
  so it is free to make.

Also confirm the extension is available:

```sql
select * from pg_available_extensions where name = 'btree_gist';
```

## Step 3 — Confirm the ledger agrees before touching anything

```bash
npm run check:migrations:ledger
```

Must pass in **both** directions — a file with no ledger row re-runs on the
next push; a ledger row with no file makes `db push` refuse outright. If this
is already failing before you start, fix that first; do not add eleven more
files on top of an inconsistent ledger.

## Step 4 — Apply with db push, not with MCP

```bash
supabase db push
```

Use `db push` so the filename *is* the recorded version. MCP `apply_migration`
assigns its own timestamp at apply time, which is exactly how this repository
previously ended up with a schema that was right, a ledger that was right, and
the two describing different things.

If `db push` is unavailable, apply through MCP **and then** re-run
`npm run check:migrations:ledger`, expecting drift and reconciling it before
opening a PR.

## Step 5 — Verify each invariant landed

```sql
-- The mirror matches the registry (14 markets, 31 selections).
select count(*) from public.op_canonical_markets;
select count(*) from public.op_canonical_selections;

-- The constraint the closing design turns on: no odds without a captured status.
select conname, pg_get_constraintdef(oid)
from pg_constraint
where conrelid = 'public.op_closing_prices'::regclass
  and conname = 'op_closing_prices_odds_only_when_captured';

-- The exclusion constraint exists, which means btree_gist resolved.
select conname from pg_constraint
where conrelid = 'public.op_market_aliases'::regclass
  and contype = 'x';

-- The widened settlement vocabulary.
select pg_get_constraintdef(oid) from pg_constraint
where conname = 'op_publications_settlement_status_check';

-- Lines that could not be recovered, reported rather than guessed.
select * from public.op_odds_line_recoverability();
```

The last one is expected to return rows: `spread`, `set_handicap` and
`total_games` never encoded a line in their names. Those staying null is the
designed outcome, not a failure.

## Step 6 — Watch one sweep before trusting the pipeline

Nothing writes until a sweep runs. Let the scheduled `refresh-results` fire, or
trigger it, then:

```sql
select verification_state, count(*)
from public.op_fixture_results
where is_current
group by verification_state;
```

Expect mostly `provisional` on the first pass — verification needs two agreeing
observations ten minutes apart, so results ripen across runs rather than
arriving verified. `conflicted` rows are findings, not errors; they will have
matching rows in `op_settlement_exceptions`.

Then check nothing settled that should not have:

```sql
select s.status, count(*)
from public.op_publication_settlements s
where s.is_current and s.rule_version is not null
group by s.status;
```

`rule_version is not null` isolates verdicts produced by the canonical engine
from the historical ones.

## Step 7 — Only then, the corrections

```bash
npm run ops:resettle
```

Dry run by default. It prints every verdict that would change and exits 1 if
there are any, so a pipeline cannot mistake pending corrections for success.

**Read the transitions before committing them.** These are changes to a public
record. A large `lost→won` count is expected — that is the cup-tie-on-penalties
class of error being corrected — but a large `won→lost` count is not, and would
mean something is wrong with the canonical results rather than with the old
verdicts.

```bash
npm run ops:resettle -- --commit
```

## If something fails mid-apply

`supabase db push` applies each file in its own transaction, so a failure
leaves earlier files applied and later ones not. That is recoverable: fix the
failing file, re-run, and the already-applied ones are skipped by the ledger.

The one case needing care is `100100`, which contains data changes. If it fails
partway, re-running is safe — every statement in it is idempotent (`add column
if not exists`, and updates guarded by `where line is null`).

## What is still unverifiable until this runs

- Whether the line-recovery regex behaves on real column contents.
- Whether `op_record_fixture_result`'s `for update` interacts correctly with the
  one-current partial index under concurrent sweeps.
- Whether the closing minimum depth of three books is a reasonable threshold or
  an assumption that makes coverage look broken. Measure it:

```sql
select depth, count(*) from (
  select count(distinct bookmaker) as depth
  from public.op_odds_snapshots
  where is_live = false
  group by fixture_id, market, selection
) t group by depth order by depth;
```

If most groups have fewer than three books, the threshold is wrong and
`MIN_SOURCE_DEPTH` in `src/lib/closing/policy.ts` should change before any
coverage number is quoted.
