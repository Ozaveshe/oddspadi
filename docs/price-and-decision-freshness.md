# Price and decision freshness

When a number stops being usable, and when a conclusion drawn from it does.

## Why not one threshold

There was a single implicit staleness cutoff for everything, which is wrong in
both directions at once. A Premier League 1X2 price is still roughly right two
hours out. A tennis match price can be stale in minutes, because two-way markets
on a short card move on every break of serve. One number either hides prices
that were fine, or — worse — lets a dead price support a live value claim.

So the budget is **per sport and per market**, and halves inside the last hour
before kick-off, which is when lines move most and when a visitor is most likely
to act on one.

| Sport | Default | Notable markets |
|---|---|---|
| Football | 15 min | totals / handicap 10 min, BTTS 12 min |
| Basketball | 8 min | totals / spread 6 min |
| Tennis | 5 min | totals 4 min |
| Anything else | 10 min | — |

These are **policy, not measurement** — the intervals we are willing to stand
behind publicly. They should be revisited against observed line movement rather
than treated as discovered constants. `priceTtlMs()` in
`src/lib/sports/lifecycle/priceState.ts` is the only place they live.

## Price states

| State | Shown | May back a value claim |
|---|---|---|
| `fresh` | yes | **yes** |
| `ageing` | yes, marked | no |
| `stale` | no | no |
| `expired` | no | no |
| `closed` | no | no |

Two ordering rules matter:

- **Kick-off outranks age.** A five-second-old price on a match already under
  way is not a stale pre-match price — it is not a pre-match price at all.
- **An explicit `expires_at` outranks the age budget.** If the provider withdrew
  it, how recently we captured it is irrelevant.

Beyond three times its budget a price stops being shown at all.

## Decision states

The decision *vocabulary* already existed: `DecisionStatus` says what the engine
concluded, `SettlementStatus` says how it turned out. Neither said whether the
conclusion is still usable **now** — and a pick generated at 09:00 for a 15:00
kick-off is a different object at 14:59, at 15:01 and at 21:00. All three
rendered identically.

`decisionState()` in `src/lib/sports/lifecycle/decisionState.ts` takes three
inputs, because a decision goes stale three ways that are not interchangeable:

| Actionability | Means |
|---|---|
| `actionable` | Current |
| `price-moved` | Still stands; the number under it does not |
| `expired` | Past the window we will stand behind it for |
| `closed` | The match is under way or over — moot, not late |
| `settled` | Outcome known. History |
| `no-decision` | The engine published nothing to act on |

Precedence, highest first: **settlement** (an outcome cannot be un-known), then
whether a selection existed at all, then the **fixture's** state (a decision
about a kicked-off match is moot rather than late), then the decision's own
expiry, then the **price** — which downgrades rather than disqualifies.

### Actionable is not the same as claim-supporting

`supportsClaim` is deliberately stricter. A decision whose price has moved is
still a legitimate opinion; it is **not** evidence of an edge, because the edge
was measured against a price that no longer exists. A decision with no price at
all is likewise actionable but claim-less — absence of a number is not evidence
of a good one.

## Where this sits

`fixtureState.ts` decides whether the match is open. `priceState.ts` decides
whether the number is current. `decisionState.ts` combines both with the
decision's own clock. Each is pure, takes `now` explicitly, and is covered by
pinned-instant tests — see [temporal-model.md](temporal-model.md).
