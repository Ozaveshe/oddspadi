# Decision taxonomy

*Source of truth: [`src/lib/domain/states.ts`](../src/lib/domain/states.ts).
Enforced by `src/test/publication-ledger-integrity.test.ts`.*

## Why this document exists

OddsPadi produces many things that look like a prediction. Before this
taxonomy, several of them were counted as one. The concrete failure: the
anon-readable public track record held 144 rows — 143 paper-mode shadow runs
and one developer smoke test — while `op_public_picks`, the table that was
supposed to hold official picks, had never held a row. One surface reported
zero settled picks; another reported graded ones. Both were reading faithfully.
Neither was reporting OddsPadi's public record, because there wasn't one.

## The nine record classes

| Class | What it is | May enter official performance? |
|---|---|---|
| `model_probability` | A calibrated number for an outcome. Not a decision. | No |
| `internal_decision` | The engine's own conclusion, published or withheld. Training evidence. | No |
| `watch_observation` | Tracked interest that has not cleared publication. | No |
| `editorial_observation` | Something an article said about a pick. | No |
| **`official_public_pick`** | **A claim published to the public before kickoff.** | **Yes — only this** |
| `community_selection` | A visitor's or tipster's tip. Separate ledger, separate leaderboard. | No |
| `simulation` | Forward simulation. Hypothetical by construction. | No |
| `backtest_record` | Historical replay over a corpus. | No |
| `shadow_decision` | Paper-mode run of a candidate model. | No |

The allowlist is a one-element set, written as a set rather than an inline
comparison so that loosening it is a visible, test-breaking change rather than
an `||` added to a condition.

## State enums

All five are defined once and imported everywhere; no page or API may declare
its own variant.

**Fixture status** — `scheduled`, `delayed`, `live`, `finished`, `postponed`,
`cancelled`, `abandoned`, `unknown`.

**Data availability** — `complete`, `partial`, `stale`, `unavailable`,
`confirmed_empty`.

> `confirmed_empty` and `unavailable` are the most important pair in this
> document. "We asked and there is nothing" and "we could not ask" must never
> render the same way. A failed read displayed as `0` is a false claim about
> the product's record, and it is exactly what happened before.

**Decision status** — `pick`, `lean`, `watch`, `pass`, `withheld`,
`unavailable`. (Presentation labels: see
[product-glossary.md](product-glossary.md).)

**Publication status** — `draft`, `published`, `corrected`, `retracted`.

**Settlement status** — `unsettled`, `won`, `lost`, `push`, `void`,
`cancelled`, `pending_verification`.

> `push`, `void` and `cancelled` are deliberately distinct from `lost`. A
> market that never resolved is not a defeat. Folding them into losses (or into
> wins) silently moves the record, and which direction it moves depends on an
> implementation detail nobody reviews.

## Rules that follow from the taxonomy

1. Only `official_public_pick` rows exist in `op_publications` — the schema
   itself constrains `record_class`, so this is not a filtering convention.
2. Community tips have their own tables, their own settlement and their own
   leaderboard. They are never merged into OddsPadi's record.
3. Backtests and shadow runs are research. `/engine/performance` may show them,
   clearly separated, and must never add them to live performance.
4. Editorial output is commentary *about* the ledger; it cites publication ids
   and never becomes evidence itself.
5. An unrecognised legacy status maps to `pending_verification`, never to a
   win or a loss. Ambiguity resolves toward "we don't know".
