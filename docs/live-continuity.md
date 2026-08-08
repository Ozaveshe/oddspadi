# Live continuity

*Implementation: [`liveContinuity.ts`](../src/lib/discovery/liveContinuity.ts).*

A fixture is one thing across its whole life. This exists to stop it becoming a
different object when it goes live.

## The three properties

**1. The route does not move.** `fixtureRoute(fixtureId)` is one function
rather than a string built at each call site — the moment two surfaces
construct it independently, one of them special-cases live and a saved link
breaks.

**2. User state is retained.** Saves and follows survive every transition.

**3. A pre-match decision is preserved, never refreshed.** It was true when it
was made. It stops being current the moment the ball moves, and the surface
must say which of those it is showing.

## Phases and provenance

| Phase | Statuses |
|---|---|
| `pre_match` | scheduled, delayed |
| `live` | live |
| `completed` | finished, postponed, cancelled, abandoned |

Provenance answers a different question from phase — not *when* but *what
produced the analysis on show*:

| Provenance | Means | May speak in the present tense? |
|---|---|---|
| `pre_match` | Made before kickoff | No |
| `live_approved` | An approved live model, while the match runs | Yes |
| `none` | No decision exists | — |

**A live model speaks only if one is approved.** Absent that, the honest live
state is a score and no probability, rather than a pre-match number wearing a
live badge.

## Transitions

`continuityHolds(before, after)` checks what a transition must preserve. It
exists for the tests rather than for runtime, because "the route is stable" is
the kind of property that is obviously true right up until a surface appends
`?live=1` and nobody notices for a month.

It fails on:

- a moved route
- user state not retained
- **a pre-match decision re-presented as an approved live model** — the failure
  that matters most, because it takes a number made before kickoff and
  presents it as a read on a match in progress
- a fixture that was presenting a result reverting to a forecast
