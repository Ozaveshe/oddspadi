# Public time copy

The words a visitor sees for every temporal state, and the rule behind them.

## The rule

**Never render a confident label to cover for silence.**

The defect this replaces: a match that finished at 14:00 still showed
"Scheduled" until a sweep noticed at 20:20. Not a wrong label — a *confident*
label, asserting something nobody had checked. A visitor deciding whether to
trust the board is better served by "we have not heard" than by a tidy word
standing in for missing evidence.

Two states exist purely to say that out loud. Neither is an apology, and neither
should be styled as breakage.

## Fixture states

Owned by `LIFECYCLE_COPY` in `src/lib/sports/lifecycle/fixtureState.ts`, kept
beside the state machine so a new state cannot ship without wording.

| State | Label | Detail |
|---|---|---|
| `scheduled` | Scheduled | Kick-off has not arrived yet. |
| `due` | Awaiting update | Kick-off has passed and we have not had an update yet. |
| `live` | Live | In play now. |
| `finished` | Finished | Final result confirmed. |
| `unresolved` | Result missing | This match should have finished. We have not received a result. |
| `postponed` | Postponed | Moved to a later date by the organisers. |
| `cancelled` | Cancelled | Called off and will not be played. |
| `abandoned` | Abandoned | Stopped after starting and not completed. |
| `suspended` | Suspended | Paused. It may resume. |

`unresolved` says the **result** is missing. It does not say the match was
abandoned — we do not know that, and a test forbids the label from claiming any
outcome word.

## Decision states

| Actionability | Copy |
|---|---|
| `actionable` | Current |
| `price-moved` | Price moved |
| `expired` | No longer current |
| `closed` | Match closed |
| `settled` | Settled |
| `no-decision` | No selection |

## Price states

| State | Copy |
|---|---|
| `fresh` | Live price |
| `ageing` | Price may have moved |
| `stale` | Price too old to show |
| `expired` | Price withdrawn |
| `closed` | Market closed |

## Rendering

`FixtureLifecycleBadge` reuses the shared `.badge` chip, so a lifecycle state
looks like every other chip on the board rather than a bolted-on system.

Four tones:

- **waiting** (`due`, `unresolved`) — muted text on the plain surface.
  Deliberately quiet: a board full of amber for "we have not heard yet" reads as
  breakage, when the honest meaning is that nothing has arrived.
- **settled** (`finished`) — green.
- **live** — the existing live red.
- **disrupted** (postponed / cancelled / abandoned / suspended) — struck
  through. Something happened *to the match*, which is worth distinguishing from
  us having lost track of it.

The detail string is always present for assistive technology, as the `title` and
as visually-hidden text, so a screen reader gets the full sentence rather than
the bare label.

## Enforcement

`src/test/lifecycle-copy-contract.test.tsx`:

- every state has a label and a detail
- `due` and `unresolved` labels contain no outcome word at all
- their details may reference an outcome only conditionally — "should have
  finished" is an honest expectation; "has finished" would be a fabrication
- each admits ignorance explicitly ("not received", "not had an update")
- every state renders without throwing

## Two vocabularies, on purpose

`FixtureStatus` (in `@/lib/domain/states`) is the normalised **provider**
status. `FixtureLifecycleState` is **our** reading of the evidence. They mirror
`op_fixtures.status` and `op_fixtures.lifecycle_state`, and collapsing them
would lose the distinction the schema exists to preserve.

The domain vocabulary turned out to already have the right shape: `delayed` and
`unknown` were the correct words for "kick-off passed, nothing heard" and "we
cannot account for this" — there was simply no way to *compute* them, so nothing
ever produced one. `due` and `unresolved` are those two states with evidence
behind them, and `LIFECYCLE_TO_FIXTURE_STATUS` maps every one onto a real
`FixtureStatus` so the two cannot drift into being synonyms.
