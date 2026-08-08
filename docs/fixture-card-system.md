# The fixture card system

*View-model: [`fixtureCard.ts`](../src/lib/discovery/fixtureCard.ts).
Component: [`FixtureCard.tsx`](../src/components/product/FixtureCard.tsx).*

One card, rendered by Today, Explore and Live. The component decides nothing;
it lays out what the view-model returns.

## Why one

There were two before this: `MatchdayFixtureCard` on the live board and
`SlateFixtureCard` on the prediction list. Two cards means two answers to
"what state is this fixture in", and they drift — not in styling, which is
visible, but in vocabulary, which is not.

`SlateFixtureCard` remains as the deep analysis surface. It shows gate
receipts, price signals and evidence quality, which is exactly what a discovery
card must not show.

## Consumer states

Eight, resolved in one direction: **lifecycle outranks verdict.**

| State | When |
|---|---|
| `pick` | A pick or lean with a current price |
| `watch` | Worth watching, not a call |
| `pass` | Analysed and not worth a bet |
| `waiting_for_odds` | A pick or lean whose price has expired |
| `analysis_unavailable` | No decision, withheld, or unavailable |
| `live` | In play |
| `finished` | Terminal |
| `result_being_verified` | Terminal, published claim, not yet settled |

Showing "Pick" on a match that ended two hours ago is the commonest way a board
goes stale-looking, which is why lifecycle wins.

**A pass does not wait for a price.** A pass is a complete analysis, not a
pending one. Only a pick or a lean degrades to `waiting_for_odds`.

**`result_being_verified` is not `finished`.** The reader is owed the
difference between "we know" and "we are checking", and only a published claim
creates that obligation.

## What the card may never show

- **Internal gate text.** `blocked: calibration_support below 0.62` is operator
  language. Summaries are checked against a marker list and replaced with the
  state's own sentence when they contain engine vocabulary — those strings
  legitimately exist upstream, and the mistake is passing them through.
- **Odds that are not current.** Historical prices are labelled as such or
  absent. The view-model nulls the price for stale quotes, live fixtures and
  finished ones, so the card structurally cannot show a price beside "no odds
  available".
- **A pre-kickoff rationale after kickoff.** "The model sees value at the
  current price" is present tense about a market that closed hours ago. Live
  and result states take their own sentence.
- **Extreme stale EV as a primary visual.** A +38% edge against an expired
  price is the most persuasive thing on the screen and the least true.

## Colour

Driven by `data-state` from the view-model, so a colour cannot disagree with
the label beside it.

Pick is green, watch is amber, live is red. **Pass, waiting and unavailable are
neutral on purpose** — a pass is a complete analysis, not a warning, and amber
would read as a near-miss.

Colour is never the only signal: the state carries an `aria-label`, and the
score is labelled for a screen reader.

## Variants

`full` and `compact`. Compact drops the summary and tightens the type; it keeps
the state and the participants, because a compact card is still a card.

## Mobile

Verified at 375px with deliberately long names (*Wolverhampton Wanderers v
Brighton & Hove Albion*): the layout collapses to one column, type drops to
17px, and the page does not scroll sideways. The live pulse and the card hover
both stop under `prefers-reduced-motion`.
