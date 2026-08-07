# Performance metrics

Every advanced performance figure OddsPadi computes, with the exact expression
behind it. Implementation: [`src/lib/performance/advancedMetrics.ts`](../src/lib/performance/advancedMetrics.ts).
Known-answer tests: [`src/test/advanced-performance-metrics.test.ts`](../src/test/advanced-performance-metrics.test.ts).

The module is pure. No I/O, no environment, no clock — anything that depends on
the present takes `now` as an argument. Given the same rows and the same `now`,
every number below is the same number forever. That is the minimum bar for a
figure anyone is going to quote in public, and it is why `computeAdvancedPerformance`
echoes its `asOf` back in the result.

Sample thresholds are enforced inside each function and documented in
[`performance-sample-policy.md`](./performance-sample-policy.md). This page
covers the maths.

## Notation and the shared denominator

| Symbol | Meaning |
| --- | --- |
| `pᵢ` | the model's forecast probability for publication `i`, in the open interval `(0, 1)` |
| `oᵢ` | the outcome: `1` if the selection won, `0` if it lost |
| `dᵢ` | the decimal odds at publication, `> 1` |
| `cᵢ` | the decimal odds at market close, `> 1`, frequently absent |
| `n` | the number of rows in the metric's denominator |

**Eligible rows** are publications whose `publicationStatus` is not
`retracted`. That matches `ledgerMetrics.computeSelectionMetrics` exactly, so
the advanced figures and the headline tiles always count the same population.

**Decided rows** are eligible rows whose `settlementStatus` is `won` or `lost`,
per `countsTowardRecord` in [`src/lib/domain/states.ts`](../src/lib/domain/states.ts).
`push`, `void`, `cancelled`, `pending_verification` and `unsettled` are **not**
decided. A push returned the stake and a void never ran; counting either as a
played selection misstates the record in both directions at once, diluting a
good record and flattering a bad one. They are still reported, as
`excludedFromRecord`, so the totals reconcile with the ledger.

**Scorable rows** are decided rows whose `modelProbability` is finite and
strictly inside `(0, 1)`.

Every metric returns a `SampledMetric`: `{ value, state, sampleSize, requiredSample }`.
`value` is `null` whenever `state` is not `"measured"`. There is no code path
that returns `0` for "we could not compute this" — a Brier score of 0 is a
perfect model, and a Brier score of unknown is unknown.

| `state` | Meaning |
| --- | --- |
| `measured` | a real number, computed over a sample that cleared its bar |
| `insufficient-sample` | the inputs exist but `sampleSize < requiredSample` |
| `not-applicable` | the quantity does not exist for this data (empty set, undefined ratio) |
| `unavailable` | an input the metric needs was never captured (e.g. closing prices) |

---

## Forecast metrics

These judge a *probability*. They apply to every scorable publication whether
or not backing it would have made money.

### Brier score

    BS = (1/n) · Σ (pᵢ − oᵢ)²

- **Domain**: `pᵢ ∈ (0, 1)`, `oᵢ ∈ {0, 1}`.
- **Range**: `[0, 1]`. Lower is better. `0` is a perfect forecaster; `0.25` is
  what you get by saying 50% every time.
- **Denominator**: scorable rows.
- **Null when**: nothing is decided, or `n < MIN_SEGMENT_SAMPLE`.

Thresholded more strictly than `ledgerMetrics.computeForecastMetrics`, which
reports a Brier score from any non-empty set. That looser rule is fine for an
internal diagnostic; for a figure quoted as evidence of skill it is not,
because the standard error over a handful of picks is wider than the whole
distance between a good model and a coin.

### Logarithmic loss

    LL = −(1/n) · Σ [ oᵢ·ln(pᵢ) + (1 − oᵢ)·ln(1 − pᵢ) ]

- **Domain**: `pᵢ` clamped to `[ε, 1 − ε]` with `ε = 1e-9`, matching
  `ledgerMetrics` so the two modules cannot disagree about the same picks. The
  `op_publications` check constraint already forbids `0` and `1`; the clamp
  rules out an `Infinity` destroying an average if a row ever arrives from
  outside the database.
- **Range**: `[0, ∞)`. Lower is better. `ln 2 ≈ 0.6931` is the score of always
  predicting 50%, and is the number to beat before claiming anything.
- **Denominator**: scorable rows.
- **Null when**: `n < MIN_SEGMENT_SAMPLE`.

Reported alongside Brier because it answers a different question. Log loss
punishes confident errors far harder: a single 99% forecast that loses costs
`4.605`, against `0.980` under Brier. A model can hold a respectable Brier
score while occasionally being certain and wrong, and only log loss says so.

### Brier skill score

    BSS = 1 − BS_model / BS_baseline
    where BS_baseline = (1/n) · Σ (p̄ − oᵢ)² and p̄ = (Σ oᵢ) / n

- **Range**: `(−∞, 1]`. Positive means better than predicting the base rate;
  `0` means exactly as good; negative means worse.
- **Denominator**: scorable rows.
- **Null when**: `n < MIN_SEGMENT_SAMPLE`, or `BS_baseline = 0` — which happens
  when every decided pick went the same way, and against an all-wins or
  all-losses set "skill" has nothing to measure. That returns `not-applicable`,
  not `0`.

The reference is the *observed* base rate rather than 0.5, which makes this a
harder test than it looks: the model only scores above zero by beating a
forecaster who already knows the answer's long-run frequency.

### Reliability curve

Probabilities are binned into `k` equal-width buckets (default `k = 10`),
`[b/k, (b+1)/k)`, with the final bucket closed at `1` so a forecast of exactly
`1` has somewhere to go. For bucket `b`:

    predicted_b = mean(pᵢ | i ∈ b)
    observed_b  = (Σ oᵢ | i ∈ b) / n_b

- **Range**: both axes `[0, 1]`. A perfectly calibrated forecaster puts every
  point on the diagonal.
- **`observed_b` null when**: `n_b < MIN_RELIABILITY_BUCKET_SAMPLE`. A Wilson
  interval accompanies it and is null whenever it is.
- **`predicted_b` is still reported** for a thin bucket. The mean of the
  forecasts we made is a fact about our own output, not an estimate of the
  world, so withholding it would be withholding something we know.
- **Whole curve null when**: fewer than `MIN_CALIBRATION_SAMPLE` scorable rows.
  In that case `buckets` and `series` are both empty — there is no partial
  curve to squint at.

### Expected calibration error

    ECE = Σ_b (n_b / n) · | predicted_b − observed_b |

- **Range**: `[0, 1]`. `0` is perfect calibration.
- **Denominator**: every scorable row. Each bucket contributes in proportion to
  its own population, so a band holding three picks cannot swing the number.
- **Null when**: `n < MIN_CALIBRATION_SAMPLE`.

ECE sums over **all** populated buckets, including those too small to draw as
individual curve points. Dropping small buckets would bias the error downwards
by discarding exactly the regions where the model is least tested. The
aggregate uses everything; the curve withholds the points a reader would
over-interpret.

### Expected versus actual wins

    expected = Σ pᵢ
    actual   = Σ oᵢ
    variance = Σ pᵢ(1 − pᵢ)                       (Poisson-binomial)
    z        = (actual − expected) / √variance
    interval = expected ± 1.96 · √variance

- **Range**: counts in `[0, n]`; `z` real.
- **Denominator**: scorable rows.
- **Null when**: `n < MIN_SEGMENT_SAMPLE`, or `variance = 0`.

The most direct calibration statement there is, and the one a non-specialist
reads fastest: "the model expected 47 winners and got 44." Because each pick is
an independent Bernoulli trial with its own probability, the win count is
Poisson-binomial, which gives both the z-score and the interval without any
approximation on the probabilities themselves. `outsideExpectation` is true
when the actual count falls outside the interval.

---

## Selection metrics

These judge a *selection at a price*. Mixing them with the forecast metrics
lets a well-calibrated model look profitable, or a lucky one look skilful.

### Hit rate

    HR = wins / (wins + losses)

- **Range**: `[0, 1]`.
- **Denominator**: decided rows. Push and void excluded, as above.
- **Null when**: `n < MIN_SEGMENT_SAMPLE`.
- Reported with a Wilson interval (`wilsonInterval` in `ledgerMetrics`), chosen
  over the normal approximation because the normal interval can extend below 0
  or above 1 and collapses to zero width at 0% or 100%.

### Return on investment (flat one-unit stake)

    returnᵢ = dᵢ − 1   if won
            = −1       if lost
    ROI     = (1/n) · Σ returnᵢ

- **Range**: `[−1, ∞)`. `−1` is every pick losing; `0` is breaking even.
- **Denominator**: decided rows.
- **Null when**: `n < MIN_SEGMENT_SAMPLE`.

Priced at publication, never at the closing line. This is the return a follower
who acted on the published pick at the published price would have seen, which
is the only ROI we are entitled to claim.

### Return distribution

Per-pick unit returns sorted into five fixed, half-open bands:

| Band | Range in units |
| --- | --- |
| `lost` | `(−∞, 0)` — in practice exactly `−1.00` |
| `small-win` | `[0, 1)` |
| `mid-win` | `[1, 2)` |
| `large-win` | `[2, 5)` |
| `outsized-win` | `[5, ∞)` |

Bands are fixed rather than data-driven so two periods are directly comparable;
data-driven bin edges would make every chart incomparable with the last one.
Each band carries a hatch `pattern` so the histogram is legible without colour.

Summary statistics — mean, median, standard deviation, `returnPerUnitOfRisk` —
are null below `MIN_SEGMENT_SAMPLE`. **Band counts are still returned below
threshold**, because a count of observed events is a fact rather than an
estimate of anything.

A single ROI figure hides the shape that matters most in betting: whether a
positive return came from a broad edge or from one 12.0 shot that landed. The
distribution is what shows the difference.

### Volatility

    s = √( Σ (returnᵢ − mean)² / (n − 1) )

- **Range**: `[0, ∞)`, in units staked. Bessel-corrected.
- **Null when**: `n < MIN_SEGMENT_SAMPLE`, or fewer than two returns exist —
  one observation has no spread, and reporting `0` would claim a certainty it
  cannot support.

`returnPerUnitOfRisk = ROI / s`, null when `s = 0`. Reported next to ROI on
purpose: a +4% return with a standard deviation of 1.8 units per pick is not
evidence of an edge, it is a number that has not had time to be tested, and the
volatility is what says so.

### Longest streaks

Longest consecutive runs of `won` and of `lost` over decided rows in
publication order (ties broken by `publicationId`, so the answer is
reproducible run to run).

- **Range**: `[1, n]`.
- Push, void and cancelled rows are **removed from the sequence** rather than
  treated as breaks. A void never ran, so it can no more interrupt a run of
  wins than a day with no picks can.
- **Null when**: nothing is decided.
- **Not sample-thresholded.** A longest run is a count of events that actually
  happened, not an estimate of a population parameter, and withholding an
  observed fact for being small would be its own kind of dishonesty. The
  `sampleSize` is returned so a surface can caption it: "3 in a row, from 5
  settled picks" is the honest rendering.

---

## Price metrics

### Closing-line value

    CLVᵢ = dᵢ / cᵢ − 1

- **Range**: `(−1, ∞)`. Positive means we published a bigger price than the
  market settled on — the market moved towards our position, which is the least
  noisy short-run evidence of an edge there is, because it does not depend on
  any result.
- **Eligible denominator**: eligible rows whose kickoff has passed relative to
  the injected `now`. A market that has not closed cannot have a closing price,
  and counting it as missing coverage would understate us.
- **Covered numerator**: eligible rows with `cᵢ > 1`.
- **Null when**: fewer than `MIN_SEGMENT_SAMPLE` covered rows. `unavailable`
  when zero are covered.

**Coverage is mandatory, not decoration.** `coverage = covered / eligible` is
reported from the first closed market, and `coverageNote` is a required field
carrying a sentence a surface can print verbatim. Closing prices are captured
by a job racing kickoff and are frequently absent; a CLV computed over 4 of 106
picks is a statement about those 4 picks and must be printed as one.

Also returned: `beatCloseRate` (share of covered picks with `CLV > 0`), a
mean interval, and five mutually exclusive bands — 5% or more below the close,
below, level, above, 5% or more above.

### Price-decay rate

    decayᵢ = ln(cᵢ / dᵢ) / lead_hoursᵢ
    where lead_hoursᵢ = (kickoffᵢ − publishedᵢ) / 3 600 000 ms

- **Range**: real. **Negative means the price shortened after we published** —
  the market came towards us, which is the direction that indicates the
  published price was good.
- **Logarithmic** because odds compound multiplicatively: a drift from 2.0 to
  1.8 and one from 5.0 to 4.5 are the same 10% move and should score the same,
  which a linear difference would not do.
- **Denominator**: covered rows with a strictly positive lead time.
- **Null when**: fewer than `MIN_SEGMENT_SAMPLE` such rows; `unavailable` at
  zero. Coverage is reported the same way CLV's is.

Reported alongside CLV rather than instead of it. CLV says how much of the move
we captured; decay rate says how quickly it happened, which is what decides
whether publishing earlier would be worth anything.

---

## Rolling series

`rollingRoi` and `rollingBrier` share one windowing scheme.

- **Anchors** are end-of-day UTC instants (`23:59:59.999`), stepping back by
  `stepDays` from the day containing `now` to the day of the earliest record,
  capped to the most recent `maxPoints` (default 90). Anchoring on day
  boundaries rather than on the records themselves keeps the x-axis evenly
  spaced and makes the series reproducible: adding a pick changes the values at
  existing points, never the points themselves.
- **Window** for anchor `A` is `(A − windowDays·86 400 000, A]`, default 30 days.
- **Membership** is by *realisation* time — `settledAt` when present, kickoff
  otherwise. A pick belongs to the window in which its market resolved, not the
  one in which it was written, or a long-dated selection would move a month's
  ROI it had not yet earned.
- Each point is `{ asOf, value, sampleSize, requiredSample, state }`. A point
  below `MIN_SEGMENT_SAMPLE` is `null` with `insufficient-sample`.

**A rolling chart that plots thin windows as 0 draws a crash that never
happened, and readers believe charts.** This matters more here than anywhere
else in the module, which is why every point carries its own state rather than
inheriting a single verdict for the series. `allWithheld` is true when no point
cleared its bar.

---

## Process metrics

### Decision coverage and abstention

Computed over `DecisionObservation[]` — every market the engine evaluated,
published or not. A ledger of publications cannot answer these, because
declining leaves no publication behind.

    coverage       = published / evaluated
    abstentionRate = (pass + withheld + unavailable) / evaluated
    blockedRate    = (withheld + unavailable) / evaluated

- **Range**: all `[0, 1]`.
- **Null when**: `evaluated < MIN_SEGMENT_SAMPLE`.

`blockedRate` is split out from abstention because the two say opposite things
about the engine. Passing on a market is the model working — it looked and
found nothing. Withholding is the model *unable* to look, and a rising blocked
rate is a data incident wearing the costume of discipline. Folding them
together is how a pipeline outage gets reported as selectivity.

`lean` and `watch` are counted as `observed`: interest short of a publishable
pick, neither an action nor an abstention.

### Publication lead time

    leadᵢ = (kickoffᵢ − publishedᵢ) / 60 000 ms

- **Range**: `(0, ∞)` minutes.
- Reported as median, p10 and p90, never a mean: lead times are right-skewed by
  a few picks published days ahead, and a mean would describe none of the
  distribution. Quantiles use linear interpolation between closest ranks (R
  type 7 / Excel `PERCENTILE.INC`), so a hand check in a spreadsheet agrees.
- Rows with `lead ≤ 0` are counted in `invalid` and excluded, not clamped. The
  `op_publications_before_kickoff` constraint makes this impossible in the
  database; a pick published after kickoff is not a prediction, and hiding one
  would hide exactly the failure worth seeing.
- **Null when**: `n < MIN_OPERATIONAL_SAMPLE`.

### Settlement latency

    latencyᵢ = (settledAtᵢ − kickoffᵢ) / 60 000 ms

- **Range**: `(0, ∞)` minutes. Rows settled at or before kickoff are `invalid` —
  a result cannot precede the match.
- **Denominator**: eligible rows carrying `settledAt`.
- **Null when**: `n < MIN_OPERATIONAL_SAMPLE`.

`outstandingPastKickoff` counts eligible rows with no `settledAt` whose kickoff
has passed relative to `now`, and `longestOutstandingMinutes` is the worst of
them. Neither is a rate and neither is thresholded: they are a census. When the
ledger holds 122 picks whose matches have finished and which nothing has
graded, a median latency over the 106 that did settle is true and useless on
its own. The count of what is still missing is the honest headline.

---

## Model-version comparison

Rows are grouped by `modelVersion`; rows carrying none group under
`"unversioned"` rather than being dropped, so the total across versions always
reconciles with the ledger total. Versions are ordered by decided count
descending — the arm with the most evidence is the natural baseline — with ties
broken on the version string for determinism.

Per version: hit rate (+ Wilson interval), ROI, Brier, log loss and expected
versus actual, each carrying its own threshold.

The difference of two hit rates uses **Newcombe's hybrid-score interval**:

    lower = (p₁ − p₂) − √( (p₁ − l₁)² + (u₂ − p₂)² )
    upper = (p₁ − p₂) + √( (u₁ − p₁)² + (p₂ − l₂)² )

where `(lᵢ, uᵢ)` is the Wilson interval of arm `i`. Chosen over the naive normal
difference interval for the same reason `wilsonInterval` is preferred to it: at
the sample sizes a model comparison actually has, the normal interval overshoots
`[−1, 1]` and behaves worst precisely at the extreme rates a new arm is most
likely to post.

`brierImprovement = BS_baseline − BS_candidate`; positive means the candidate
forecasts better.

- **The comparison is null unless *both* arms clear `MIN_SEGMENT_SAMPLE`.** A
  difference between a measured rate and an unmeasurable one is not a smaller
  difference, it is no difference at all. `blockedReason` names the short arm
  and its shortfall.
- `separated` is true only when the interval excludes zero. **That is the field
  a promotion decision should read. The point estimate is not.**

---

## Chart data and accessibility

This module builds no components, but the data shape decides whether an
accessible component is possible. A series identified only by a colour key
forces every downstream renderer into a colour-only legend.

Every chart-shaped result returns `ChartSeries`:

```ts
{
  id: string;
  label: string;
  pattern: "solid" | "dashed" | "dotted" | "dash-dot";
  marker: "circle" | "square" | "triangle" | "diamond" | "cross";
  summary: string;          // one sentence, for aria-label
  points: Array<{
    x: string;              // machine-sortable key
    xLabel: string;         // axis tick text
    y: number | null;       // null where the metric was withheld
    label: string;          // full sentence, for a screen reader or table cell
    sampleSize: number;
  }>;
}
```

Two things follow from this shape. First, the same chart is renderable as a
data table with no loss — every point already carries its own sentence.
Second, `y: null` is distinguishable from `y: 0` at the renderer, so a withheld
point can be drawn as a gap rather than as a value.

Distribution bands carry a `pattern` for the same reason: a bar chart
distinguished only by fill colour is unreadable in greyscale and to roughly one
man in twelve.
