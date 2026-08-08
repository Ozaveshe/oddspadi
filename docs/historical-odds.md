# Historical odds

*Storage: `op_odds_snapshots`. Closing policy:
[closing-price-policy.md](closing-price-policy.md).*

Training on a mixed set of prices without knowing when each was available is
the odds equivalent of a leaked feature: the model learns from information the
decision could not have had.

## What a snapshot carries

| Column | Purpose |
|---|---|
| `fixture_id` | The uuid foreign key. Joined on this, never on the text id — two write paths populate that one |
| `market`, `selection` | Provider vocabulary, resolved on read |
| `line` | The handicap or total. Null where the market carries none |
| `decimal_odds` | The price |
| `observed_at` | When we saw it — the only timestamp that decides admissibility |
| `is_live` | Excluded from every pre-match read |
| `snapshot_class` | Where in the fixture's life it sits |
| `outlier_state` | Whether it survived sanity checks |

## Snapshot classes

| Class | Meaning |
|---|---|
| `opening` | The first price observed |
| `intermediate` | Everything between |
| `decision_time` | The price a decision was made against |
| `closing` | The last qualifying pre-kickoff quote under `close.v1` |

`is_closing` is now a reading of `snapshot_class`, not an independent boolean
that can disagree with it. The migration backfilled the class from the existing
flag **before** converting, because the corpus importers were the only source
of closing quotes before 2026-05-24 and reversing those steps would have
dropped every one of them.

## The line, and what could not be recovered

`line` was backfilled only from names that encode it — `over_under_25` yields
2.5, `over_under_505` yields 50.5. Measured on production: **1,144 rows of
1,898,349** carry a recoverable line.

`spread`, `set_handicap` and `total_points` encode no line in either the market
or the selection name. Those stay null and are **reported, never guessed**, via
`op_odds_line_recoverability()`. A guessed line settles a claim against a
number nobody quoted.

This is a live limitation, not a solved problem: a claim on those markets
cannot currently be matched to a historical quote by line.

## Source depth

Derived, never stored. A snapshot row is one book's quote, so a depth column on
it would be a denormalised count of its siblings — wrong the moment another
book reports. The depth that mattered at a capture is stored on
`op_closing_prices.source_count`, where it is a fact about a decision rather
than about a row.

Measured depth in the closing window is poor and known to be so — see
[closing-price-policy.md](closing-price-policy.md) for the numbers and why the
answer is to fix collection rather than widen the definition.

## Outlier state

| State | Meaning |
|---|---|
| `normal` | Passed sanity checks |
| `suspect_overround` | The market's implied probabilities sum outside the band |
| `suspect_price` | The individual price is implausible |
| `excluded` | Held for evidence, never entering a consensus |

Excluded rows are kept. Deleting them removes the evidence that anything was
wrong along with the wrong thing.

## Reading historical odds correctly

1. Filter `is_live = false`.
2. Filter `observed_at <= decision cutoff` — not kickoff, the **cutoff**.
3. Match the line exactly. A 2.5 quote is not a price for a 3.5 claim.
4. Take one quote per bookmaker, the latest qualifying one.
5. Record how many books that left, and treat a thin market as thin rather than
   as a consensus.
