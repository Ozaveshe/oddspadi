# Query-plan evidence

*Captured 2026-08-01 against the production database. Every claim in
[public-read-architecture.md](public-read-architecture.md) traces to a plan or
a `pg_stat_statements` row here.*

## Slowest statements before the change

`pg_stat_statements`, excluding one-off diagnostic queries (`calls = 1`):

| Statement | Calls | Mean | Max | Total |
|---|---|---|---|---|
| `op_training_snapshot_counts()` | 1,320 | 3,743 ms | 7,975 ms | 4,940,757 ms |
| `op_training_corpus_census()` | 109 | 5,083 ms | 7,999 ms | 554,020 ms |
| `op_odds_snapshots` by sport+provider | 21 | 6,158 ms | 7,761 ms | 129,313 ms |
| `op_prune_stale_odds()` | 19 | 5,464 ms | 6,272 ms | 103,807 ms |
| `op_mark_closing_odds()` | 19 | 5,299 ms | 7,018 ms | 100,677 ms |

`statement_timeout` on the `authenticator` role is **8,000 ms**. The first two
are reachable from `/engine/performance`; their maxima sit 1–25 ms below
cancellation. The last two are scheduled jobs and are expected to be slow.

## Table sizes driving the cost

| Table | Live rows | Total size |
|---|---|---|
| `op_fixture_decision_summaries` | 618,169 | 2,406 MB |
| `op_odds_snapshots` | 1,256,005 | 685 MB |
| `op_market_decisions` | 510,888 | 299 MB |

## Before: today's slate join

```sql
select s.fixture_id, s.sport, s.public_status, s.generated_at, s.best_watchlist_candidate
from op_fixture_decision_summaries s
join op_fixtures f on f.id = s.fixture_id
where f.kickoff_at >= now() and f.kickoff_at < now() + interval '24 hours'
  and s.superseded_by is null
order by f.kickoff_at asc limit 200;
```

```
Limit  (actual time=31.036..31.074 rows=200)
  Buffers: shared hit=13818 dirtied=1
  ->  Hash Join  (actual time=12.029..30.838 rows=340)
        ->  Bitmap Heap Scan on op_fixture_decision_summaries
              Recheck Cond: (superseded_by IS NULL)
              Heap Blocks: exact=13336            ← ~108 MB of heap
              rows=5857
        ->  Index Scan using op_fixtures_window_sync_idx on op_fixtures
Execution Time: 31.411 ms
```

Fast in wall-clock, but it reads 5,857 summary rows and 13,336 heap blocks to
produce 340 — cost that grows with the table, on every request.

## After: the projection read

```sql
select payload, row_count, status, built_at, source_max_at, builder_version
from op_public_projections where name = 'daily_fixture_slate' and scope = '2026-08-01';
```

```
Index Scan using op_public_projections_pkey  (actual time=0.031..0.031 rows=1)
  Index Cond: ((name = 'daily_fixture_slate') AND (scope = '2026-08-01'))
  Buffers: shared hit=2
Execution Time: 0.101 ms
```

**13,818 → 2 buffers; 31.411 → 0.101 ms.**

## Why the plan was not the whole story

The v1 projection still measured **p95 1,921.8 ms** under load despite that
plan. The payload was 501 kB; the cost was transfer, not execution. Reducing it
to 148 kB (builder v2) brought p95 to **672.8 ms**. Recorded here because it is
the counter-example to trusting `EXPLAIN` alone.

## Indexes: none added

The remaining candidate was `op_prediction_outcomes` filtered by sport, read by
the promotion gate board:

```
Limit  (actual time=0.777..4.483 rows=468)
  ->  Seq Scan on op_prediction_outcomes
        Filter: (sport = 'football'::text)
        Rows Removed by Filter: 1082
  Buffers: shared hit=1 read=90
Execution Time: 4.614 ms
```

1,550 rows total, 90 buffers, 4.6 ms. The planner correctly prefers a
sequential scan; an index would be **speculative and would not be used**. No
index was added. Revisit if that table passes roughly 50k rows.

## Unused indexes (reported, not dropped)

`idx_scan = 0` since the last statistics reset, over 2 MB:

| Index | Size |
|---|---|
| `op_market_decisions_public_window_idx` | 33 MB |
| `op_player_match_performances_provider_fixture_player_key` | 10 MB |
| `op_market_decisions_superseded_by_idx` | 7.9 MB |
| `op_player_match_performances_player_recent_idx` | 4.6 MB |
| `op_training_feature_snapshots_fixture_idx` | 3.5 MB |
| `op_fixtures_away_kickoff_idx` | 2.4 MB |
| `op_fixtures_home_kickoff_idx` | 2.3 MB |

~63 MB of index carrying write cost with no recorded reads. **Not dropped**:
`pg_stat_database.stats_reset` is null, so the counters have an unknown start
and a seasonal or rarely-run query could still depend on one. Two of these
(`op_player_match_performances_*`) sit on a table with 0 live rows and are
unique constraints, so they are correctness structures rather than dead weight.
Dropping the rest is a separate change that should follow a deliberate
observation window.

## Reproducing

```bash
npm run ops:loadtest -- --iterations 150 --concurrency 15 --compare
```
