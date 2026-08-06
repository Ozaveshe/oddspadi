# The temporal model

Every instant OddsPadi stores, what it means, and who is allowed to infer what
from it.

## The rule

**UTC in storage, the visitor's timezone at the boundary, and never a state
inferred from the scheduled time alone.**

The third clause is the one that was being broken. `op_fixtures` carried
exactly one instant that said anything about the match itself — `kickoff_at` —
so "has it finished?" could only ever be answered as *kickoff plus a
sport-shaped guess*. That guess was rendered to visitors as a fact.

## The eleven times

Audited 2026-08-06. Seven existed, four did not.

| Time | Column | Notes |
|---|---|---|
| Provider scheduled | `op_fixtures.provider_kickoff_at` | **Added.** Kickoff as the provider last stated it. Keeping it beside `kickoff_at` makes a reschedule visible instead of overwriting the original. |
| Canonical scheduled | `op_fixtures.kickoff_at` | What the product treats as kick-off. |
| Provider update | `op_fixtures.provider_updated_at` | **Added.** When the *provider* says the fixture changed. `last_synced_at` is when we last read it — a sync returning identical data advances that and must not advance this. |
| Ingestion | `op_fixtures.created_at` / `updated_at` | Our write times. |
| Model generation | `op_market_decisions.generated_at` | |
| Odds capture | `op_current_odds.captured_at` | `observed_at` is the provider's stamp where it gives one. |
| Odds expiry | `op_current_odds.expires_at` | |
| Publication | `op_publications.published_at` | |
| Actual start | `op_fixtures.started_at` | **Added.** Null means *unknown*, never "not started". |
| Final result | `op_fixtures.resulted_at` | **Added.** Null means *unknown*. The only honest basis for "finished". |
| Settlement | `op_publications.settled_at` | |

History is **not** backfilled with inventions. `provider_kickoff_at` is set to
`kickoff_at` because at ingest they were the same value and no reschedule was
ever recorded — that is true, not assumed. `started_at` and `resulted_at` stay
null on old rows, because writing `updated_at` into them would manufacture
evidence we never had.

## What a day means

`src/lib/time/dayWindow.ts` is the only place a day boundary is resolved.

Before it, `utcDateWindow` built its range from `Date.UTC`, so *today* was the
UTC day for everyone. Measured on 2026-08-06:

| Zone | Fixtures in "today" |
|---|---|
| UTC | 472 |
| Australia/Sydney | 563 |
| America/Los_Angeles | 412 |

A Sydney visitor at 09:00 was shown a board built for a day that had already
ended where they were standing.

An offset applied at render time does not fix this — by then the query has
already selected the wrong *rows*. The boundary has to be resolved before the
read, so the timezone has to reach the server.

### How the zone reaches the server

The preference lived only in `localStorage`, which a server render cannot see.
It is now mirrored into a cookie:

- `LocalTime.tsx` → `publishTimeZoneToServer()` writes `oddspadi-tz`
- `src/lib/time/timezoneCookie.ts` → `readTimezonePreference()` reads it

The attributes are written twice because `timezoneCookie.ts` imports
`next/headers` and cannot be bundled into a client component.
`timezone-cookie-contract.test.ts` asserts the two copies stay identical — a
drift would be silent, with the server quietly falling back to Africa/Lagos and
the picker appearing to do nothing.

`TimezonePicker` also publishes on mount, which backfills visitors who chose a
zone before the cookie existed.

Two properties the implementation is careful about:

- **DST.** `endUtc` comes from the *next day's* start, not from adding 24
  hours, so a spring-forward day is 23 hours and an autumn day 25. Adding a
  fixed day silently drops or double-counts an hour of fixtures.
- **Untrusted input.** The zone arrives from a cookie. An unrecognised value
  degrades to the default rather than throwing inside a server render — a
  mistyped cookie must not be able to blank the board.

Reading a cookie opts a route out of static rendering. Every surface calling
this is already `force-dynamic`; a static page must not start calling it
casually.

## Fixture state

`src/lib/sports/lifecycle/fixtureState.ts`. Derived from timestamps at read
time, and the same function is what reconciliation uses to decide what to
write — one rule evaluated twice cannot disagree with itself.

| State | Means | Actionable |
|---|---|---|
| `scheduled` | Kick-off is in the future | yes |
| `due` | Kick-off passed, no provider evidence yet | no |
| `live` | Observed in play | no |
| `finished` | A final result was observed | no |
| `unresolved` | Past its plausible window, no evidence either way | no |
| `postponed` / `cancelled` / `abandoned` / `suspended` | Provider-stated | no |

Evidence precedence, highest first:

1. **An observed result** outranks everything, including a provider status
   still saying "live".
2. **A provider-stated disruption** — nothing in a timestamp implies
   "postponed".
3. **A legacy `finished` with no result time** is trusted only when a score
   backs it up. Otherwise it is the old batch job's guess, which is what this
   replaces.
4. **An observed start** means live.
5. **The clock**, which can only distinguish `scheduled` / `due` /
   `unresolved` — and each of those says out loud that we do not know.

`due` and `unresolved` are the honest answers the system previously could not
express. Neither is terminal; both are quarantine states, not write-offs.

### Play windows

Longest a match plausibly runs, from kick-off: football 4h, basketball 4h30,
tennis 8h, anything else 6h.

These exist twice — here and in `op_expire_stale_fixtures`. Two copies of a
policy drift, so `temporal-lifecycle.test.ts` parses the migration and asserts
they agree.

## Price state

`src/lib/sports/lifecycle/priceState.ts`. Budgets are **per sport and per
market**, and halve inside the last hour before kick-off.

One global threshold is wrong in both directions at once: a Premier League 1X2
price is still roughly right two hours out, while a tennis match price can be
stale in minutes because two-way markets move on every break of serve.

| State | Shown | May support a value claim |
|---|---|---|
| `fresh` | yes | **yes** |
| `ageing` | yes, marked | no |
| `stale` | no | no |
| `expired` | no | no |
| `closed` | no | no |

Kick-off outranks age: a five-second-old price on a match already under way is
not a stale pre-match price, it is not a pre-match price at all.

The numbers are **policy, not measurement** — the intervals we are willing to
stand behind publicly. They should be revisited against observed line movement
rather than treated as discovered constants.

## Testing time

Every instant in `temporal-lifecycle.test.ts` is pinned. Time is the one input
a test must never read from the machine it runs on: a suite that passes at noon
in London and fails at 23:59 in Lagos is worse than no suite at all.
