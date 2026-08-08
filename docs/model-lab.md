# Model lab

How a candidate model is evaluated before it is allowed near a reader.

*Promotion: [model-promotion.md](model-promotion.md).
Data contract: [point-in-time-features.md](point-in-time-features.md).
Reproducibility: [model-dataset-versioning.md](model-dataset-versioning.md).*

## What "smarter" means here

Better calibrated probabilities, better out-of-sample scoring, better use of
market information, stronger uncertainty estimation, better abstention, better
closing-line performance, reproducibility, and sport-specific modelling.

It does not mean more prose, more agents or more picks. **Complexity is not a
success criterion**, and a more complex model does not get promoted unless
untouched chronological evaluation supports it.

## The order of work

1. **Reproduce the baseline before changing anything.** A candidate compared
   against a champion nobody can rebuild is compared against a memory.
2. **Implement strong transparent baselines.** A market-prior baseline and a
   simple rating model. If the sophisticated candidate cannot beat those, that
   is the finding.
3. **Evaluate chronologically.** Walk-forward folds only; see
   [model-promotion.md](model-promotion.md).
4. **Calibrate on prior validation data only.** A calibrator fitted on the
   holdout has spent it.
5. **Gate.** Ten gates, all of which must pass, none of which passes on missing
   evidence.

## Metrics

| Metric | Answers |
|---|---|
| Brier | Squared error of the probability |
| Brier skill score | Whether it beats a stated reference |
| Log loss | Penalty for confident errors |
| ECE | Whether stated probabilities match observed frequencies |
| Reliability | Calibration by band |
| Sharpness | Whether the model says anything at all |
| RPS | Ordered-outcome error where order matters |
| Segment stability | Whether an aggregate win hides a local collapse |

Sharpness is kept beside calibration deliberately. A model that predicts the
base rate for everything is perfectly calibrated and completely useless, and
ECE alone cannot tell you that.

## The market prior

De-vigged consensus, weighted by recency, completeness, reliability, outlier
state, source depth and historical close quality. **Never a blind average of
bookmaker odds** — a thin book and a sharp book do not carry the same
information, and averaging them asserts they do.

Shin per book, then median across books, for the reason
[closing-price-policy.md](closing-price-policy.md) gives: proportional de-vig
overstates every longshot, and a median of raw implied probabilities cannot
wash that out because every book carries the same bias.

## The ensemble

A versioned blend of the independent sport model, a statistical baseline, the
market prior and a calibration layer. Blend weight may vary by sport, market,
competition, data completeness, time to start, lineup availability and
historical performance.

**A weak independent model does not receive more authority than a strong market
baseline.** The market is a well-resourced opponent, and a blend that
systematically overweights our own view is a preference, not a finding.

## The LLM boundary

An LLM may extract structured news, resolve entities, summarise verified
factors and generate explanations.

It may not invent a probability, override calibrated output through prose,
invent injuries or news, create retrospective evidence, or expose
chain-of-thought. A public explanation derives from a structured output — it
never *is* the output.

## What exists today

**Built:** the promotion gate with ten conditions and an explicit unknown
verdict, walk-forward fold construction and validation, fold summarisation that
reports thin folds rather than dropping them. Brier, log loss, ECE and skill
score already existed in
[`advancedMetrics.ts`](../src/lib/performance/advancedMetrics.ts).

**Built since (2026-08-08):** the candidate models and their first honest
runs. Dixon–Coles Poisson and Davidson-draw Elo for football 1X2
(`src/lib/model/poissonDixonColes.ts`, `eloFootball.ts`), surface Elo with
rank-prior cold starts and de-canonicalised orientation for tennis
(`tennisElo.ts`), calibration selection on validation only with a 2,000-sample
floor for isotonic (`calibrationFit.ts`), a log-opinion-pool ensemble whose
grid includes "market alone", and paired-bootstrap evaluation
(`evalMetrics.ts`). Harnesses: `scripts/model-lab-run.ts` and
`scripts/tennis-lab-run.ts`.

**The results, as found:** neither sport's model beats the de-vigged market on
its untouched 2026 holdout — football ΔBrier +0.0238 [0.0131, 0.0343] vs the
close, tennis +0.0451 [0.0368, 0.0533] vs the consensus, and both ensembles
collapse toward the market (w=0.00 and w=0.15). Full numbers and findings:
[model-evaluation-report.md](model-evaluation-report.md) and
[model-evaluation-report-tennis.md](model-evaluation-report-tennis.md).

**Registry:** both candidates are registered in `op_model_registry`
(migration `20260808120000`) and sit in **shadow** — the lifecycle table
enforces the state paths of `src/lib/model/registry.ts` in Postgres, with
append-only history and evidence demanded at every transition. Neither may
publish; that is the finding operating as policy.

**Not built:** a production feature pipeline that would let these models score
live fixtures from stored point-in-time features (the lab runs on the
versioned training corpus), and uncertainty-aware abstention wired into the
runtime decision path. Stating the gap here is the point — a lab document that
reads as a description of a working lab is worse than no document.
