# Calibration and uncertainty

*Uncertainty synthesis: [`uncertainty.ts`](../src/lib/model/uncertainty.ts).
Metrics: [`advancedMetrics.ts`](../src/lib/performance/advancedMetrics.ts).
Consumed by: [decision-policy.md](decision-policy.md).*

## Calibration

A probability is calibrated when things said to happen 60% of the time happen
60% of the time. Everything downstream — edges, EV, the publishable claim —
assumes it, so it is measured, not presumed.

**Candidate methods:** Platt scaling, isotonic regression, beta calibration,
multiclass extensions, hierarchical shrinkage for thin segments. Selection runs
on **prior validation data only** — a calibrator fitted on the holdout has spent
it, and the holdout is the one set that cannot be bought twice.

**Measured by:** Brier, log loss, ECE, reliability by band, sharpness, RPS
where outcomes are ordered, and segment stability.

Sharpness sits beside calibration deliberately: a model that predicts the base
rate everywhere is perfectly calibrated and completely useless, and ECE alone
cannot see that.

Calibration support is per sport, market and odds band. A market with no
profile does not get a borrowed one — the decision policy withholds, because an
uncalibrated probability is a guess wearing a decimal.

## Uncertainty

One blended "confidence" score makes *why is this uncertain* unanswerable. So
every source keeps its name:

`ensemble_dispersion`, `bootstrap`, `data_missingness`,
`calibration_uncertainty`, `market_disagreement`, `identity_uncertainty`,
`lineup_uncertainty`.

The output carries a point probability, a conservative bound, an interval, and
the widest sources first — the answer reads off the top.

**Widths combine by root-sum-square, not plain addition.** The sources are not
perfectly correlated, and a plain sum grows so fast that every fixture with
three named doubts becomes unpublishable — which teaches people to stop naming
doubts. That incentive is worse than the approximation.

**The conservative bound is the number that gets staked.** The match page may
show the point estimate and the interval; the policy stakes on the low end. And
the bound never reaches zero or one — a zero-probability claim is not a bet, it
is a refusal wearing numbers.

Every uncertainty statement on a surface derives from this one estimate; two
surfaces computing their own intervals is how a page contradicts itself, and
the prohibited-contradiction suite asserts against it.
