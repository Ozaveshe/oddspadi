# Fixture reconciliation

How stored fixture state is brought back into agreement with the evidence, and
how to audit what it decided.

## Two columns, deliberately

| Column | Meaning | Written by |
|---|---|---|
| `op_fixtures.status` | The provider's last word | ingestion only |
| `op_fixtures.lifecycle_state` | **Our** reading of the evidence | `reconcileFixtureLifecycles()`, `op_expire_stale_fixtures` |

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

## The sweep, and the 50 picks it voided

`op_expire_stale_fixtures` used to write `status = 'abandoned'` on the same
fixtures the reconciler now quarantines. Its own comment admitted the problem in
plain words — *in most of these cases the match did finish and we simply never
received the result* — and settled for it because `abandoned` "settles as void,
which is the honest outcome for a result we never received."

It is not. Void is a claim that the market never resolved. The cost, measured
2026-08-07: **52 of 134 settled publications were void, and 50 of those were
matches that were played** — 22 competitions over four days, Leagues Cup, EFL
Cup, Liga Profesional. The provider was answering on those days; on 2026-08-03
the Toronto WTA 1/64-finals returned 17 finished fixtures with scores and one
expiry. "Did not answer about this match" is not "the match was called off".

Since `20260807050311_quarantine_stale_fixtures.sql` the sweep writes
`lifecycle_state = 'unresolved'`, leaves `status` untouched, and appends to
`op_fixture_lifecycle_transitions` like the reconciler it shares its rules with.
`metadata.expiredReason` / `statusBeforeExpiry` stay — that trail is the only
reason the damage was repairable.

`marketDecisionSettlement` no longer voids a quarantined fixture; it returns
`needs_review`, and `settlePublications` leaves the claim unsettled. Only a
provider-stated cancellation, postponement or abandonment voids.

### Repairing rows the old sweep wrote

`op_repair_inference_expired_fixtures(p_commit)` — preview by default.

```sql
select * from public.op_repair_inference_expired_fixtures(false);
```

It restores `status` from `metadata.statusBeforeExpiry`, writes
`lifecycle_state = 'unresolved'` with a transition row per fixture, and
withdraws every publication verdict that rested on the forged status via
`op_unsettle_publication` — the sanctioned correction path, so the prior state
lands in `op_publication_revisions` and shows up in the public correction log.
Idempotent: the repair moves rows off `status = 'abandoned'`, so a second run
matches nothing.

Run 2026-08-07: **1,841 fixtures and 50 publications repaired.** Void fell from
52 to 2; the two survivors are provider-stated cancellations. Won (35) and lost
(47) did not move — no verdict was invented, only withdrawn.

```sql
-- What the sweep has quarantined that the provider still calls scheduled.
select f.sport, f.status, count(*)
from public.op_fixtures f
where f.lifecycle_state = 'unresolved'
group by 1, 2 order by 3 desc;
```

The audit row is written *before* the state change. If the update then fails we
are left with a claim of a transition that did not happen — noisy but
detectable. The reverse, a silent state change with no record, is the failure
this table exists to prevent.

## Clearing the quarantine

Repairing the forged statuses left 1,888 fixtures sitting at
`lifecycle_state = 'unresolved'`. That is the honest state, but it is not a
resting place: the count does not shrink on its own, and every publication on
one of those fixtures stays unsettled.

Two things were stopping it from ever shrinking.

**The reconciler could not see a fixture it had already quarantined.** The scan
filtered on `status in ('scheduled', 'live')`, so the moment a recovery wrote
`status = 'finished'` the row dropped out of the only job that can clear
`lifecycle_state`. Measured 2026-08-07: twelve football fixtures held a final
score, a `resulted_at` **and** `lifecycle_state = 'unresolved'` at the same
time. The scan is now two reads — the forward path (past kick-off, still
`scheduled`/`live`, inside `lookbackHours`) and a release path over anything in
a quarantined state, at any age and whatever its status.

**PostgREST was truncating the backlog at 1,000 rows.** `db-max-rows` caps a
response whatever `.limit()` asks for, and says nothing about having done it.
Against 1,888 quarantined rows a single read returned 1,000 and looked complete;
32 fixtures that already held a final score were stranded on page two. Both
reads now keyset-paginate on `id` — not `kickoff_at`, which ties — and stop on
an empty page rather than a short one, because "short means last" quietly stops
being true the moment the server's cap is lower than the page size.

### Recovering results the sweep cannot reach

`npm run ops:backfill-results` asks the provider about *specific fixtures* rather
than about a date, which is what lets it reach past both the curated league
registry and the scheduled window. Dry run by default.

```bash
npm run ops:backfill-results              # preview
npm run ops:backfill-results -- --commit
npm run ops:reconcile-lifecycles -- --commit   # releases what came back
```

It writes `status` and scores only. `lifecycle_state` is the reconciler's to
write, because that is what records the transition — setting both in the
backfill would produce a state change with no audit row.

### What is actually reachable

Provider windows are not documentation, they are enforced, and **API-Sports
reports a refusal as HTTP 200 with a populated `errors` object**. A run that
looks clean can be one hundred per cent rejected, which is why the backfill
prints a per-provider call ledger before any outcome counts.

Measured 2026-08-07:

| Provider | Reach | Evidence |
| --- | --- | --- |
| API-Football | No practical limit | A fixture 26.5 days old still returned `AET` |
| api-basketball (Free) | **Yesterday only** | *"Free plans do not have access to this date, try from 2026-08-06 to 2026-08-08."* |
| api-tennis | ~9 days | Needs `API_TENNIS_KEY`; absent from some environments |
| The Odds API `/scores` | 3 days | `daysFrom` caps at 3 |

Anything older than its provider's window is **permanently** beyond reach. It
stays `unresolved`. Do not mark it abandoned, do not delete it, and do not infer
a result — an unknown outcome is not the same as no outcome.

```sql
-- The quarantine backlog, split by whether anyone can still answer for it.
select
  case
    when f.provider in ('api-football', 'api_football') then 'api-football (reachable)'
    when f.provider = 'api-basketball' and f.kickoff_at::date >= current_date - 1
      then 'api-basketball (in window)'
    when f.provider = 'api-basketball' then 'api-basketball (BEYOND window)'
    when f.provider = 'api-tennis' and f.kickoff_at >= now() - interval '9 days'
      then 'api-tennis (in window)'
    when f.provider = 'api-tennis' then 'api-tennis (BEYOND window)'
    when f.kickoff_at >= now() - interval '3 days' then 'the-odds-api (in window)'
    else 'the-odds-api (BEYOND window)'
  end as segment,
  count(distinct f.id) as fixtures,
  count(distinct p.id) as unsettled_publications
from public.op_fixtures f
left join public.op_publications p
  on p.fixture_id = f.id and p.settlement_status = 'unsettled'
where f.lifecycle_state = 'unresolved'
group by 1 order by fixtures desc;
```

Run 2026-08-07, after recovery: **1,662 fixtures remain quarantined**, of which
**1,143 are permanently unresolvable** — 490 api-basketball and 365 api-tennis
and 288 The Odds API fixtures whose windows have closed. The other 519 are
reachable given a credential or tomorrow's quota. Thirty-one publications rest
on quarantined fixtures and are correctly held at `unsettled`; settlement grades
them `needs_review` rather than guessing.

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
- **It does not reach back indefinitely — for fixtures it has not judged yet.**
  `lookbackHours` (default 96) bounds the forward scan to fixtures a provider
  might still resolve. Older rows are history, and re-deciding them serves
  nobody. The release path is deliberately exempt: quarantine is an open
  backlog, not a window, and a fixture we have admitted we cannot account for is
  owed an answer however old it is. The oldest currently in it is 27 days.
