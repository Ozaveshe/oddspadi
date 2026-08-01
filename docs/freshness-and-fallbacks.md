# Freshness and fallbacks

*How OddsPadi stays usable when providers, jobs or the database are late.*

## Last-known-good, by construction

Every public surface has a last successful projection, and the write path is
built so it cannot be destroyed by a failure:

```sql
if p_status = 'refresh_failed' then
  -- record the attempt; never touch payload
  update op_public_projections
  set last_attempt_at = now(), last_error = p_error
  where name = p_name and scope = p_scope;
  return;
end if;
```

Verified against production: a simulated failed refresh kept all 250 slate rows
and recorded the error. A test asserts the failure branch contains no
`payload =` assignment, so the property cannot be edited away silently.

## Every surface carries

| Signal | Column | Used for |
|---|---|---|
| Last successful projection | `payload` | What the page renders |
| Projection timestamp | `built_at` | "Snapshot built 22:15" |
| Source-data timestamp | `source_max_at` | Newest source record reflected |
| Freshness threshold | `FRESHNESS_THRESHOLD_MS` | When to disclose age |
| Last attempt | `last_attempt_at` | Detecting a silently failing refresh |
| Failure detail | `last_error` | Operators only, never rendered |

## Degradation ladder

1. **Healthy** — refresh succeeds every 5 minutes; pages render `complete`.
2. **Provider late** — builders still run against stored data. Fixtures render;
   decisions may be `partial`.
3. **Refresh failing** — the last good payload is served as `stale` with its
   age. The public status turns `delayed`.
4. **Database unreachable** — the read itself fails: `unavailable`, no rows, an
   explicit "this is not a zero".

The product only stops showing data at step 4, and at step 4 it stops making
claims rather than making false ones.

## Caching

| Surface | Layer | TTL | Notes |
|---|---|---|---|
| Projection store | database | 5 min refresh | The source of truth for pages |
| `/api/status` | CDN | 30 s + 120 s SWR | Cheap and safe to serve slightly stale |
| Today/tomorrow tips | `unstable_cache` | 300 s / 90 s | Existing wrappers, now over cheaper reads |
| Live board | `unstable_cache` | 30 s | Tightest TTL; matches its 3-minute staleness threshold |
| Match pages | ISR | 180 s | Per-fixture |
| Performance / track record | ISR | 300 s | Ledger-backed |

Stale-but-verified content is served while a refresh happens asynchronously.
Past the freshness threshold, the age becomes visible — never silent.

### Invalidation after settlement

Settlement changes the record, so the affected projections must be rebuilt
rather than waiting out a TTL. The outcome-ledger sweep (`:40`) and the
projection sweep (`*/5`) are ordered so a settlement is reflected within one
projection cycle; `performance_summary` reads the ledger directly, so no
second-order cache can disagree with it.

## Scheduled jobs

| Job | Cadence | Purpose |
|---|---|---|
| `projection-refresh-sweep` | `*/5 * * * *` | Rebuild all public projections (~137 ms) |
| `outcome-ledger-sweep` | `40 * * * *` | Closing odds → settlement → outcomes → prune |
| decision cycles | `5,35 * * * *` | Model runs |

The projection sweep takes no pipeline lock: builders only read operational
tables and write their own rows, so a concurrent run is redundant rather than
harmful. The outcome ledger does take the lock, because it writes.

## Failure modes covered by tests

`src/test/public-read-resilience.test.ts` (23 tests):

- database timeout **with** a last-known-good snapshot → `stale`, rows served
- database timeout **without** a snapshot → `unavailable`, no rows
- no database configured → `unavailable`
- confirmed-empty slate → `confirmed_empty`, distinguishable by `built_at`
- stale snapshot → correct age, rows still served
- partial coverage → `partial`
- payload from a newer builder → `unavailable`, not misparsed
- payload of the wrong shape → `unavailable`
- duplicate scheduled execution → idempotent by primary key
- public status sanitisation → only two fields, no leakage
- no raw error in the notice component
- no error-to-zero conversion anywhere in the read model
