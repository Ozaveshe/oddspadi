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

## Measured state, 2026-08-02

Run against production. These are results, not targets.

```
scope: 0 publications, 28,158 fixtures, 16 stories, 6 projections, 0 community tips
6 findings, 0 critical — all stale-projection
```

**Every projection was stale.** Five at 168 minutes, one at 2,431 minutes
(≈40 hours), against a 5-minute refresh interval. The refresh sweep is not
completing. This is a live operational finding, not a threshold artefact.

**The official ledger holds zero publications.** Every ledger check therefore
passed vacuously, and the job says so in as many words rather than printing a
clean report. An empty finding list against an empty ledger is not evidence of
correctness.

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
