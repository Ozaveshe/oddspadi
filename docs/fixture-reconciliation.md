# Fixture reconciliation

How stored fixture state is brought back into agreement with the evidence, and
how to audit what it decided.

## Two columns, deliberately

| Column | Meaning | Written by |
|---|---|---|
| `op_fixtures.status` | The provider's last word | ingestion, `op_expire_stale_fixtures` |
| `op_fixtures.lifecycle_state` | **Our** reading of the evidence | `reconcileFixtureLifecycles()` |

The obvious design was to add `due` and `unresolved` to `status`. That is wrong
twice: it overwrites what the provider told us with what we inferred —
destroying the evidence the inference was drawn from — and it silently widens a
vocabulary a dozen consumers already switch on.

So they sit side by side. **When they disagree, the disagreement is the
finding.** A fixture the provider still calls `scheduled` that we call
`unresolved` is exactly the row an operator wants to see.

`lifecycle_state` null means *not yet reconciled*, which is honest for history.
The read path can derive the state itself and does not depend on the job having
run — that dependency was the original defect.

## The job

`src/lib/sports/lifecycle/reconcile.ts`, run from
`POST /api/cron/refresh-results` after the provider refresh, so a fixture is
only ever reconciled once one more genuine attempt to resolve it has been made.

It calls the same `fixtureLifecycle()` the pages call. That is the whole point:
the previous arrangement had the sweep encode its rules in SQL and the pages
encode theirs in TypeScript, so *"is this match over?"* had two answers that
drifted between deploys.

### Idempotent

A transition is written only when the derived state differs from **our own last
reading** — not from the provider's status, which legitimately differs and
would otherwise churn every row on every run. A second run over unchanged data
writes nothing, so it is safe on a schedule and safe to re-run after a partial
failure.

### Auditable

Every correction appends to `op_fixture_lifecycle_transitions`:

```sql
select f.sport, t.from_state, t.to_state, t.basis, t.overdue_hours, t.occurred_at
from public.op_fixture_lifecycle_transitions t
join public.op_fixtures f on f.id = t.fixture_id
order by t.occurred_at desc
limit 50;
```

Append-only, holding both states and the basis. The old sweep wrote its reason
onto the fixture row, so the second correction erased the first and there was no
way to answer *"how often are we writing off matches the provider later
resolved?"* — which is the question that tells you whether the windows are
right:

```sql
-- Quarantine calls we later reversed. A rising number means the play windows
-- are too tight for that sport.
select f.sport, count(*) as reversed
from public.op_fixture_lifecycle_transitions t
join public.op_fixtures f on f.id = t.fixture_id
where t.from_state = 'unresolved' and t.to_state = 'finished'
group by 1 order by 2 desc;
```

The table is operator information — it exposes how often our own inference is
wrong — so RLS denies it to `anon` and `authenticated`.

### Non-destructive

Nothing is deleted, and nothing is marked finished on inference. A fixture past
its window with no evidence becomes `unresolved`: quarantined, still queryable,
still resolvable by a later provider read. **`unresolved` is not terminal**, and
a test asserts a quarantined fixture returns to `finished` once a result
arrives.

`reconcile.ts` contains no `.delete(`, and a test enforces that.

The audit row is written *before* the state change. If the update then fails we
are left with a claim of a transition that did not happen — noisy but
detectable. The reverse, a silent state change with no record, is the failure
this table exists to prevent.

## Running it by hand

```bash
curl -X POST "$SITE/api/cron/refresh-results?commit=false" -H "x-oddspadi-schedule-token: $TOKEN"
```

`commit=false` is a preview: it reports every change it *would* make and writes
nothing. Always preview before committing a window you have not run before.

## What it does not do

- **It never writes `live`.** Deciding a match is in play is the provider's job;
  inferring it from a clock is the mistake this replaces.
- **It never touches `status`.** A test asserts the update patch contains
  `lifecycle_state` and not `status`.
- **It does not reach back indefinitely.** `lookbackHours` (default 96) bounds
  the scan to fixtures a provider might still resolve. Older rows are history,
  and re-deciding them serves nobody.
