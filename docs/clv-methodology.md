# CLV methodology

*Implementation: [`clv.ts`](../src/lib/closing/clv.ts). Version: `clv.v1`.
Closing input: [closing-price-policy.md](closing-price-policy.md).*

## Two series, both kept

```
odds-based         published_odds / closing_odds − 1
probability-based  p_close_novig − p_published_novig
```

Both carry the same sign — positive means the price beat the close.

They disagree in magnitude on longshots, which is why both are kept. A selection
backed at 12.0 that closed at 9.0 reads as +33% on the odds series; the
probability series says the market moved 2.8 points toward us, which is the
honest size of it. This book has been misled by exactly that gap before: the
displayed tips were once `argmax(model − market)` longshots with a 25% hit rate,
and an odds-only CLV series would have flattered them.

`published_probability_novig` is stored on the closing row so the probability
figure is reproducible without re-deriving the publication-time market. It
describes the *publication*, not the close, so it is recorded on every capture
attempt including the failed ones — a row with `capture_status = 'no_quotes'`
still records what we published at.

## A missing close is never zero

Every aggregate returns `covered`, `uncovered` and `mean` as one non-optional
triple:

```ts
type ClvSeries = {
  covered: number;
  uncovered: number;
  mean: number | null;
  median: number | null;
};
```

A caller cannot render the mean without also holding the denominator it was
taken over. That is the whole defence — not a rule about how to treat nulls, but
a return type that will not let you forget them. When nothing is covered the
mean is `null`, not `0`.

The two series are independent. A close with odds but no de-viggable market
gives `odds.covered = 1` and `probability.covered = 0`, and neither number is
invented from the other.

## Interpreting it

- CLV is a measure of **price**, not of outcome. A pick that beat the close and
  lost still beat the close.
- It is only as good as the closing policy behind it. A `close.v1` figure
  measures the median of at least three books inside a 90-minute window; it is
  not "the closing line" in any absolute sense, and comparisons against
  externally published CLV figures are not like-for-like.
- Coverage belongs beside every CLV claim. A mean over 12 covered picks out of
  400 eligible is a statement about 12 picks.

## What must not be done with it

- Do not promote a model on CLV alone, and not on short-window CLV at all. See
  the promotion gates in the calibration path.
- Do not fill a missing close with the last available price to raise coverage.
  That is the failure this method exists to prevent, and it is invisible once
  done.
- Do not average the two series together. They measure the same movement on
  different scales.
