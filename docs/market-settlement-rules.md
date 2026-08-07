# Market settlement rules

*Engine: [`grade.ts`](../src/lib/settlement/grade.ts). Definitions:
[`canonicalMarkets.ts`](../src/lib/markets/canonicalMarkets.ts). Suite:
`src/test/settlement-fixture-suite.test.ts`.*

Every market states its settlement basis. Provider naming never selects a rule
— canonical market keys do, resolved through the alias layer described in
[provider-market-mapping.md](provider-market-mapping.md).

## Football

| Market | Basis | Rule |
|---|---|---|
| `football.1x2.regulation` | Normal time | Extra time and penalties ignored. A cup tie level at 90 minutes settles as a draw however it was eventually decided. |
| `football.double_chance.regulation` | Normal time | Wins if either covered outcome occurs. |
| `football.draw_no_bet.regulation` | Normal time | A draw returns the stake as a `push`. |
| `football.asian_handicap.regulation` | Normal time | Line applied to the backed side's score. Whole line landing exactly → `push`. Quarter line → split (below). |
| `football.total_goals.regulation` | Normal time | Total landing exactly on a whole line → `push`. |
| `football.btts.regulation` | Normal time | Whether both teams scored. |
| `football.to_qualify.including_shootout` | Extra time and penalties | The only football market that reads past normal time. |

Postponed, cancelled and abandoned fixtures void every market before any rule
reads a score that is not there.

## Basketball

| Market | Basis | Rule |
|---|---|---|
| `basketball.moneyline.full_game_incl_ot` | Final score including overtime | Two-way. A tie is unrepresentable and returns `needs_review` rather than a guess. |
| `basketball.moneyline.regulation` | End of the fourth quarter | **Three-way** — a game tied after regulation settles the draw selection. |
| `basketball.spread.full_game_incl_ot` | Including overtime | Margin landing exactly on a whole line → `push`. |
| `basketball.total_points.full_game_incl_ot` | Including overtime | Total landing exactly → `push`. |

Include-or-exclude-overtime is **two rule ids, not one flag**. A mapping mistake
is then a missing rule, which is loud, instead of a wrong basis, which is
silent. The regulation market being three-way where the full-game market is
two-way is the reason a flag could never have worked: one of them has an
outcome the other does not.

A shortened game voids below the league's completion threshold. Default: all
four quarters.

## Tennis

| Market | Basis | Retirement | Walkover |
|---|---|---|---|
| `tennis.match_winner.full_match` | The awarded winner | **Settles** on the awarded winner | Void |
| `tennis.set_handicap.full_match` | Sets won | **Void** | Void |
| `tennis.total_games.full_match` | Games played | **Void** | Void |

Settling the match winner on a retirement is the bookmaker-majority convention
and is OddsPadi's stated rule, not a provider default we inherited. The set and
games markets void because the count never reached its final value even though
the match has a winner — the same event, two correct and opposite answers,
which is exactly why the rule has to be declared per market.

A platform that voids the match winner on retirement is therefore
`different_settlement`, not an equivalent market. See
[platform-conversion.md](platform-conversion.md).

## Outcomes

| Outcome | Profit per unit at odds `o` | In the accuracy denominator? |
|---|---|---|
| `won` | `o − 1` | Yes |
| `half_won` | `(o − 1) / 2` | Yes |
| `push` | `0` | No |
| `half_lost` | `−0.5` | Yes |
| `lost` | `−1` | Yes |
| `void` | `0` | No |
| `needs_review` | `0` | No |

`return_multiple` is carried on the settlement rather than re-derived by each
consumer, because a half win is precisely the case an ad-hoc ROI calculation
gets wrong.

### Asian quarter lines

A quarter line is settled as two half-stakes on the neighbouring half lines.
Home `+0.25` on a draw: the `0` half pushes, the `+0.5` half wins → `half_won`.
Home `−0.25` on a draw: the `0` half pushes, the `−0.5` half loses →
`half_lost`.

Collapsing a quarter line onto its nearest half — the alternative to adding
these outcomes — misprices every one of them by half a stake, invisibly.

## Properties

- **Pure.** No I/O, no clock. The same result revision, claim and rule version
  always produce the same verdict, so replay is free and the suite runs without
  a database.
- **Idempotent** by storage, not by the engine: `op_settle_publication()` and
  the one-current partial index make repeating a run harmless.
- **Versioned.** Every verdict carries `market_key`, `rule_version` and
  `settlement_basis`. A re-settle under a new rule version supersedes rather
  than overwrites.
- **Correction-aware.** A corrected result produces a new settlement pointing at
  the new `result_id`.

## What settlement refuses to do

- Settle an unverified result, whatever the score says.
- Void an unmapped market. A void says the market never resolved; an unmapped
  market resolved fine and we cannot read it. Those are different claims about
  the world, and only one of them is true.
- Grade a handicap with no line.
- Pick a side on a two-way market that finished tied.
- Rewrite a published probability or price. Settlement writes only to
  `op_publication_settlements`.
