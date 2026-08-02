# Public read architecture

*Read model: [`src/lib/readmodel/publicProjection.ts`](../src/lib/readmodel/publicProjection.ts).
Store: [`20260801012405_public_projection_store.sql`](../supabase/migrations/20260801012405_public_projection_store.sql).
Builders: [`…012511`](../supabase/migrations/20260801012511_public_projection_builders.sql),
[`…013409`](../supabase/migrations/20260801013409_compact_daily_slate_projection.sql).*

## The problem, measured

`pg_stat_statements` on 2026-08-01, before any change:

| Query | Calls | Mean | Max |
|---|---|---|---|
| `op_training_snapshot_counts()` | 1,320 | **3,743 ms** | 7,975 ms |
| `op_training_corpus_census()` | 109 | **5,083 ms** | 7,999 ms |
| `op_odds_snapshots` by sport+provider | 21 | **6,158 ms** | 7,761 ms |

The API role's `statement_timeout` is **8,000 ms**. Those three ran on the
public performance page, so it was rendering within ~25 ms of cancellation.
And a cancellation did not surface as an error — it was caught and rendered as
"0 fixtures" and "no value picks".

Even the healthy path was expensive. `EXPLAIN (analyze, buffers)` on today's
slate join:

```
Execution Time: 31.411 ms
Buffers: shared hit=13818        ← ~108 MB of heap
rows=340                          ← to return 340 rows
```

That cost came from filtering `op_fixture_decision_summaries` — **618,169 rows,
2,406 MB** — on every request.

## The architecture

Public pages read **one row** from `op_public_projections`, keyed
`(name, scope)`. The payload is prepared jsonb. All expensive work happens in a
scheduled job.

```
providers ─┐
           ├─→ operational tables ─→ [scheduled builders, in-database] ─→ op_public_projections ─→ page
model jobs ┘        (618k rows)              every 5 minutes                  (one PK lookup)
```

Projections currently built:

| Projection | Scope | Rows | Payload | Build |
|---|---|---|---|---|
| `daily_fixture_slate` | date | 250 | 148 kB | 70 ms |
| `daily_fixture_slate` | date+1 | 112 | 68 kB | 34 ms |
| `live_fixture_board` | — | 89 | 29 kB | 3 ms |
| `latest_engine_status` | — | 10 | 906 B | 26 ms |
| `performance_summary` | — | 0 | 87 B | 4 ms |

Whole refresh: **~137 ms**, off the request path.

## Pipeline properties

- **Idempotent** — `primary key (name, scope)` + `on conflict … do update`. A
  duplicated schedule tick rebuilds; it cannot duplicate.
- **Incremental where practical** — the slate is scoped per date and the live
  board to a ±6h window, so a rebuild touches only the current window.
- **Versioned** — `builder_version`. The reader refuses a payload newer than it
  understands rather than misparsing it; that is how v1 → v2 shipped safely.
- **Observable** — `built_at`, `last_attempt_at`, `build_duration_ms`,
  `row_count`, `status`, `last_error`, plus one structured log line per sweep.
- **Rebuildable** — `select op_refresh_public_projections();`.
- **Safe during partial failure** — each builder owns its exception handler, so
  one failing projection cannot stop the others, and a failed refresh
  **preserves the previous payload**. Verified against production: the failure
  path kept all 250 rows and recorded the error.

## Measured result

Load test, 150 iterations at concurrency 15, from a developer machine over the
public internet (`scripts/load-test-public-reads.mjs`):

| Path | p50 | p95 | p99 | req/s |
|---|---|---|---|---|
| Projection read (v1, 501 kB payload) | 808.7 ms | 1,921.8 ms | 2,913.8 ms | 13.6 |
| **Projection read (v2, 148 kB payload)** | **279.7 ms** | **672.8 ms** | 709.5 ms | 46.6 |
| Live board projection | 177.6 ms | 210.9 ms | 241.7 ms | 77.4 |
| Raw slate join (the old path) | 393.7 ms | 769.9 ms | 817.0 ms | 33.4 |

**Budget (p95 < 800 ms): met at 672.8 ms.**

Two honest caveats:

1. These numbers include ~150–250 ms of round-trip internet latency per
   request from the test machine. A Netlify function co-located with the
   database will be materially faster; this is a pessimistic measurement, not
   an optimistic one.
2. The v1 result is the more instructive number. `EXPLAIN` said 0.101 ms while
   the load test said 1,921 ms p95 — because the cost was **payload transfer**,
   not execution. The fix was to resolve the displayed candidate in the
   database and ship five fields instead of three nested decision objects
   (501 kB → 148 kB). Query plans alone would not have found this.

## Rules

1. A public page may not query `op_odds_snapshots`, `op_market_decisions` or
   `op_fixture_decision_summaries` directly. Enforced by a test asserting the
   read model imports none of them.
2. No provider `fetch()` on a render path. Enforced by the same test file.
3. Anything expensive belongs in a builder, not a request.
4. A new projection must declare a freshness threshold in
   `FRESHNESS_THRESHOLD_MS` before it can be read.

## Known remaining work

The audit found public paths still reading operational tables directly:
`/predictions/league/[slug]/table` (uncached provider call, up to twice per
render), `/predictions/today` (unguarded live-board fan-out), `/community`
(live provider fan-out to populate a `<select>`), and `readStoredSlate`'s
weekly window silently truncating at `limit(1000)` against ~700 fixtures/day.
Those are candidates for the next projections; they are listed here rather
than left implicit.
