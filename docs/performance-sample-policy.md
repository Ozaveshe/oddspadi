# Performance sample policy

What minimum sample each performance metric needs before OddsPadi will print
it, why that number, and what a surface must show instead when the bar is not
met.

Formulas live in [`performance-metrics.md`](./performance-metrics.md).
Enforcement lives in [`src/lib/performance/advancedMetrics.ts`](../src/lib/performance/advancedMetrics.ts) —
**in the library, not in the caller**.

## The rule

> **A small sample is reported as unknown. It is never rendered small.**

There is no font size, caption, asterisk or grey italic that makes "100% win
rate" backed by three decisions honest. A reader takes the number and leaves
the caption. So the library does not return the number: below threshold it
returns `value: null` with `state: "insufficient-sample"`, and there is nothing
for a surface to print even if it wanted to.

The corollary matters just as much: **null is not zero**. A Brier score of 0 is
a perfect model. A hit rate of 0 is a total failure. Both are strong claims,
and substituting either for "we do not know" is a lie in a specific direction.
Every metric in the module returns `null` with a reason, never a zero.

## Why thresholds are enforced in the library

A surface that has to remember to check `n` before printing a percentage will
one day forget. This repository has already shipped that failure — a "100% win
rate" that was three decisions reached a public page, because the rate was
computed at the call site and the sample check was somewhere else. The fix that
removed it is the reason `rateWithMinimumSample` exists in `ledgerMetrics`, and
this module extends the same discipline to every metric rather than to the one
that got caught.

So the check is not available to skip. `sampledMetric(compute, sampleSize, requiredSample)`
does not even *run* `compute` when the sample is short, which removes the
possibility of a later refactor reading a `.value` that should never have been
calculated.

## Thresholds

| Metric | Required n | Constant | Derived or policy |
| --- | --- | --- | --- |
| Brier score | 30 decided | `MIN_SEGMENT_SAMPLE` | policy |
| Log loss | 30 decided | `MIN_SEGMENT_SAMPLE` | policy |
| Brier skill score | 30 decided | `MIN_SEGMENT_SAMPLE` | policy |
| Expected calibration error | 50 scorable | `MIN_CALIBRATION_SAMPLE` | policy |
| Reliability curve (whole) | 50 scorable | `MIN_CALIBRATION_SAMPLE` | policy |
| Reliability curve (per bucket) | 30 in bucket | `MIN_RELIABILITY_BUCKET_SAMPLE` | policy, aliased to `MIN_SEGMENT_SAMPLE` |
| Expected vs actual wins | 30 scorable | `MIN_SEGMENT_SAMPLE` | policy |
| Hit rate | 30 decided | `MIN_SEGMENT_SAMPLE` | policy |
| ROI | 30 decided | `MIN_SEGMENT_SAMPLE` | policy |
| Return distribution (statistics) | 30 decided | `MIN_SEGMENT_SAMPLE` | policy |
| Return distribution (band counts) | 1 | — | census, not an estimate |
| Volatility | 30 decided | `MIN_SEGMENT_SAMPLE` | policy |
| Longest streaks | 1 decided | — | census, not an estimate |
| CLV (mean, median, beat-close rate) | 30 covered | `MIN_SEGMENT_SAMPLE` | policy |
| CLV coverage | 1 eligible | — | census, not an estimate |
| Price-decay rate | 30 covered | `MIN_SEGMENT_SAMPLE` | policy |
| Rolling ROI / rolling Brier (per point) | 30 in window | `MIN_SEGMENT_SAMPLE` | policy |
| Decision coverage, abstention, blocked rate | 30 evaluated | `MIN_SEGMENT_SAMPLE` | policy |
| Publication lead time | 10 | `MIN_OPERATIONAL_SAMPLE` | policy |
| Settlement latency | 10 | `MIN_OPERATIONAL_SAMPLE` | policy |
| Outstanding past kickoff | 0 | — | census, not an estimate |
| Model-version comparison | 30 in **each** arm | `MIN_SEGMENT_SAMPLE` | policy |

### `MIN_SEGMENT_SAMPLE = 30` — policy, and here is how weak it is

Thirty is the textbook central-limit rule of thumb. It is inherited from
`ledgerMetrics`, and reused rather than re-litigated so the codebase has one
bar instead of two — a second convention is worse than an imperfect first one,
because then two surfaces disagree and both are defensible.

It is honestly a floor for *printing*, not a bar for *proving*. At `n = 30` and
`p = 0.5` the 95% Wilson interval is `[0.332, 0.668]` — plus or minus about 17
percentage points. Thirty settled picks tell you almost nothing about a hit
rate. What they do is stop a single result from moving the headline by tens of
points, which is the specific failure mode that reaches a screenshot.

What a *derived* threshold would look like, for scale. To distinguish a true
55% hit rate from a coin at 5% two-sided significance and 80% power:

    n = ( z_{α/2}·√(p₀(1−p₀)) + z_β·√(p₁(1−p₁)) )² / δ²
      = ( 1.96·√0.25 + 0.8416·√(0.55·0.45) )² / 0.05²
      ≈ 783

And to distinguish a true +5% ROI from break-even, with a per-pick return
standard deviation of about 1.5 units (typical at odds around 2.5):

    n = (z_{α/2} + z_β)² · σ² / δ²
      = 7.849 · 2.25 / 0.0025
      ≈ 7 064

So: roughly 800 settled picks before a hit-rate claim is testable, and roughly
7 000 before an ROI claim is. Thirty is not that. Nothing in this module should
be described as evidence of an edge at anything close to current sample sizes,
and the honest framing for the whole page today is "an early record, not a
track record".

### `MIN_CALIBRATION_SAMPLE = 50` — policy

Also inherited from `ledgerMetrics`. Fifty scorable rows across ten buckets
averages five per bucket, which is not enough for any individual bucket — which
is exactly why the per-bucket bar is separate and higher. Fifty is the point
below which the *aggregate* ECE stops being dominated by a single band's noise.
It is a judgement call, not a derivation.

### `MIN_RELIABILITY_BUCKET_SAMPLE = 30` — policy, aliased deliberately

A calibration curve is a set of independent proportion estimates, one per
bucket, so each point needs what any published proportion needs. Aliasing it to
`MIN_SEGMENT_SAMPLE` rather than picking a new number keeps one bar across the
codebase.

The consequence is worth stating plainly: a fully populated ten-bucket curve
wants roughly 300 graded decisions. Until then, individual points report as
unknown rather than as noise drawn at full opacity, and the curve will look
sparse. A sparse honest curve is the correct output.

### `MIN_OPERATIONAL_SAMPLE = 10` — policy, with a real reason for being lower

Lead time and settlement latency get a looser bar than performance claims, and
the distinction is substantive rather than convenient.

A hit rate estimates an unknown parameter of the world; it needs enough events
to separate skill from variance, and the variance is enormous. Publication lead
time measures a process we own and control — the publisher runs on a schedule,
so the distribution is narrow and its median is stable almost immediately.
Being wrong about it is also cheap: nobody stakes money on a median latency.

Ten is still a policy number. It is set where a median stops being decided by a
single row.

### Metrics with no threshold, and why that is not an inconsistency

Four results are censuses rather than estimates: return-distribution band
counts, longest streaks, CLV coverage, and the count of publications
outstanding past kickoff.

A census is a count of things that happened. "Three wins in a row" is not an
estimate of a streak parameter; it is a fact, and withholding an observed fact
for being small would be its own kind of dishonesty — it also happens to hide
bad news, which is when the temptation would arise. These results carry their
`sampleSize` so a surface can caption them truthfully: "3 in a row, from 5
settled picks."

The line between the two categories is whether the number is about the world
(threshold) or about our own output (no threshold). The mean of the
probabilities we forecast in a band is our output; the win rate in that band is
the world. That is why `reliabilityCurve` reports `predicted` for a thin bucket
and withholds `observed`.

## How "insufficient sample" is presented

Every metric returns `SampledMetric`:

```ts
{ value: null, state: "insufficient-sample", sampleSize: 12, requiredSample: 30 }
```

Both numbers are present so a surface can say *which*, and
`describeSampleShortfall()` returns the sentence:

> Not enough settled decisions yet: 12 of the 30 needed.

That reads as candour. A bare em dash reads as a bug, and a spinner reads as a
page that is still loading. The other three states have their own sentences:

| `state` | Rendered as |
| --- | --- |
| `insufficient-sample` | "Not enough settled decisions yet: {n} of the {required} needed." |
| `not-applicable` | "Not applicable to this set." |
| `unavailable` | "The inputs for this measurement are missing." |
| `measured` | the number |

Chart points follow the same rule. A withheld point is `y: null` with a `label`
explaining the shortfall, so a renderer draws a gap and a screen reader hears
the reason. A withheld point must never be plotted at zero: a rolling chart
that renders thin windows as 0 draws a crash that never happened, and readers
believe charts.

## Where this leaves us today

`op_publications` holds 230 rows, all published on **2026-08-03**: 106 graded
(44 won, 62 lost, 2 void) and 122 unsettled. Against the table above:

- **Computable now.** Hit rate, ROI, volatility, return distribution, Brier,
  log loss, Brier skill, ECE, expected vs actual — all clear their bars on 106
  decided rows. They are still early numbers, and
  `ledgerMetrics.SMALL_SAMPLE_WARNING_THRESHOLD` (100) is only just cleared.
- **Sparse but real.** The reliability curve clears the 50-row bar overall, but
  most of its ten buckets will hold fewer than 30 rows and will report as
  unknown. Expect a curve with two or three drawn points.
- **A single point.** Every rolling series has one publication day behind it,
  so `rollingRoi` and `rollingBrier` return one or two anchors. The series are
  correct and uninformative, and will become informative without any code
  change.
- **Uncomputable.** CLV and price decay return `unavailable` — no closing
  prices are captured on `op_publications` at all, so coverage is 0 of 106 and
  `coverageNote` says so.
- **Uncomputable.** Model-version comparison returns `blockedReason`: one day
  of publishing means one model version, and there is no second arm.
- **Uncomputable without a caller.** Decision coverage and abstention need the
  decision population, which the publication ledger cannot supply.
  `computeAdvancedPerformance` returns `coverage: null` when no decisions are
  passed, rather than a coverage of 100% derived from the picks that happen to
  exist.

Most of the page is therefore going to say "not yet". That is the correct
output for a one-day-old record, and it is the output that stays correct as the
record grows.
