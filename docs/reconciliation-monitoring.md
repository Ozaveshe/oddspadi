# Reconciliation and monitoring

## The job

```bash
npm run ops:reconcile-truth
```

Read-only. Compares the publication ledger against fixtures, settlements,
editorial citations, the projection store and community references.

Exit codes: `0` clean, `1` critical findings, `2` could not complete.

### Two rules it is built around

**It never writes.** Not a correction, not a backfill, not a status flip. A job
that repairs history while reporting on it destroys the evidence that the
repair was needed — "the reconciler fixed it" becomes indistinguishable from
"it was never broken". Corrections go through the append-only revision path in
[publication-ledger.md](publication-ledger.md), operated deliberately.

**It never reports zero on failure.** An unreadable source is a finding of its
own, printed under `COULD NOT CHECK`, and forces exit 2. This rule was written
after the first draft of the script wrapped its optional reads in
`.catch(() => [])` and duly announced "0 projections" against a store holding
six — reproducing, inside the reconciler, the exact error-becomes-empty defect
it exists to catch.

### What it reports

| Finding | Severity | Meaning |
|---|---|---|
| `publication-after-kickoff` | critical | The claim postdates the event. This is the single fact that makes a track record a forecast. |
| `missing-publication-time` | critical | A published claim with no timestamp is not evidence. |
| `duplicate-publication` | critical | Two live publications for one selection. |
| `non-official-in-ledger` | critical | A shadow, backtest or community record in the official ledger. |
| `missing-canonical-identity` | critical | A publication pointing at a fixture that does not exist. |
| `conflicting-fixture-result` | critical | Graded won/lost/push on a fixture that never finished. |
| `settlement-before-result` | critical | Settled while the fixture is still running. |
| `missing-settlement` | critical | Terminal for over 60 minutes, still unsettled. |
| `article-count-without-ids` | critical | Copy states a pick count and cites no publication IDs. |
| `article-cites-unknown-publication` | critical | A story cites an ID the ledger does not hold. |
| `missing-odds-snapshot` | warning | Published with no recorded price. |
| `stale-projection` | warning | Older than 3× the refresh interval. |
| `orphaned-community-fixture` | warning | A member tip against a fixture that does not exist. |

## Measured state, 2026-08-03

Run against production. These are results, not targets.

```
scope: 0 publications, 28,214 fixtures, 16 stories, 7 projections, 0 community tips
no findings
```

**The official ledger holds zero publications.** Every ledger check therefore
passed vacuously, and the job says so in as many words rather than printing a
clean report. An empty finding list against an empty ledger is not evidence of
correctness.

### Incident: projections frozen for 8.5 hours

The first run of this job, on 2026-08-02, reported every projection stale —
five at 168 minutes and one at 2,431, against a 5-minute refresh interval. That
was a real outage, found by this job on the day it was written.

**Cause.** `projection-refresh-sweep` had been given an inbound
`x-oddspadi-schedule-token` check so the job would be authenticated in code
rather than merely shielded by the platform refusing external invocation. The
intent was right; the placement was not. Netlify invokes a scheduled function
with no headers — there is no caller to set one — so every tick returned 401
before touching the database. Public projections stopped rebuilding at
**15:16 UTC**, the minute that check deployed, and stayed frozen until the fix
shipped at 00:14 UTC.

**Fix.** Split into `projection-refresh-sweep` (schedule, forwards the token)
and `projection-refresh-worker-background` (verifies it, runs the RPC) — the
shape the other ten sweeps already used. Recovery confirmed within two refresh
cycles: stale count 4 → 0.

**Guards.** Two rules in `src/test/job-endpoint-security.test.ts`, either of
which would have failed the original commit: a scheduled function may not gate
on an inbound token, and may not reach the database.

**One correction to this job itself.** It initially warned about a past-dated
slate scope. The orchestrator rebuilds today and tomorrow only, so those rows
are finished rather than stale. Left in, the warning would have fired every day
forever — and a monitor that cries wolf daily is precisely how the real
staleness went unnoticed in the first place.

## Acceptance targets vs measured reality

The brief sets targets. Where one cannot yet be measured, the gap is stated
rather than the target claimed.

| Target | Measured | Honest status |
|---|---|---|
| 100% cross-page reconciliation for official publication IDs | 0 publications exist | **Unmeasurable.** Vacuously true. The machinery is in place and tested against synthetic worlds. |
| Zero finished-match contradictions | 1 found and fixed (`ABD`) | **Now enforced** by `cross-surface-consistency.test.tsx`. |
| Zero raw operational objects exposed | 0 on the probed surfaces | Enforced by `job-endpoint-security.test.ts` and `operational-boundary.test.ts`. |
| Zero failed reads shown as confirmed empty | 0 in tests | Enforced by the coherence model and the cross-surface suite. |
| Zero official picks without pre-kickoff evidence | 0 publications | **Unmeasurable**, enforced by a Postgres constraint. |
| Settlement within 60 min of a final result | no settled publications | **Unmeasurable.** The reconciler will report it once the ledger fills. |
| Closing-line capture above the gate | not measured here | See the engine audit. |
| ≥99.5% public read availability | not instrumented | **Not measured.** No availability metric is collected. |
| No unbounded public database queries | keyset pagination in the read paths | Partially enforced; no test fails a build on an unbounded query. |

## Observability — what exists and what does not

The brief lists thirteen signals. Being precise about which are collected:

| Signal | Status |
|---|---|
| Projection age | **Collected.** `built_at` per row; the reconciler reports it. |
| Model-run delay | **Collected.** `op_provider_ingestion_runs` and `/api/cron/*` receipts. |
| Fixture-import delay | **Collected.** `op_fixtures.last_synced_at`. |
| Odds-import delay | **Collected.** `op_odds_snapshots.captured_at`. |
| Settlement delay | **Derivable.** The reconciler computes it; nothing stores a time series. |
| Publication delay | **Derivable** once publications exist. |
| Public unavailable-state rate | **Not collected.** |
| Public read latency | **Not collected** in production. `load-test-public-reads.mjs` measures on demand. |
| Closing-line coverage | **Collected** in calibration receipts. |
| Identity-resolution failures | **Not collected** as a metric. |
| Error-to-empty prevention | **Enforced in code**, not counted. |
| Cache hit rate | **Not collected.** |
| Route errors | **Not collected** beyond platform logs. |

Six of thirteen are collected. Stating that plainly is the point: an
observability doc that lists thirteen signals as if all were instrumented is
the same class of error as a track record built from shadow rows.

### Alert thresholds

For the signals that exist:

| Signal | Warn | Page |
|---|---|---|
| Projection age | > 15 min (3× refresh) | > 60 min |
| Fixture import | > 2 h since last sync | > 6 h |
| Odds import | > 90 min | > 4 h |
| Settlement lag after terminal | > 60 min | > 4 h |
| Provider run status | `partial` twice consecutively | `failed`, or no run in 2 h |
| Reconciler | any warning | any critical, or exit 2 |

## Scheduling

The reconciler is not yet scheduled. Running it hourly alongside the outcome
ledger sweep is the intended shape; it is deliberately left manual until the
ledger holds publications, because an hourly job that reports "0 publications,
no findings" trains operators to ignore it.
