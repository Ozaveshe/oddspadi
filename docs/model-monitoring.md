# Model monitoring

*Registry states: [`registry.ts`](../src/lib/model/registry.ts). Alert
discipline: [settlement-exceptions.md](settlement-exceptions.md).*

What is watched after a model is approved, and what happens when it slips.

## Tracked

| Signal | Question it answers |
|---|---|
| Feature drift | Are the inputs still shaped like the training data? |
| Prediction drift | Has the output distribution moved? |
| Calibration drift | Do stated probabilities still match outcomes? (`calibrationDriftGuard` exists) |
| Market disagreement | Has the gap to the de-vigged market widened? |
| Missingness | Are features arriving? |
| Coverage | Is the model declining more fixtures than it used to? |
| CLV | Are published prices still beating the close? |
| Abstention rate | Withheld/unavailable share — a rising rate is a symptom either way |
| Latency | Decision production time, p95 |
| Segment collapse | Is one sport or band degrading inside a healthy aggregate? |

Segment collapse is listed separately because it is what every aggregate metric
is best at hiding — the same reason the promotion gate refuses an aggregate win
built on a segment loss.

## The degradation contract

**A degraded model abstains.** In the registry that is one transition —
`approved → degraded` — and `mayPublish` becomes false while `mayShadow` stays
true: the model keeps producing comparisons and loses its public voice.

Recovery is not "it seems fine again". `degraded → approved` demands a fresh
promotion-gate run, because *seems fine* is the evidence-free judgement the
gate exists to replace. The alternative path is `degraded → rolled_back`, which
demands a target that was itself once approved — rolling back onto an
unapproved model would promote it by accident, and the registry refuses it.

## Monitoring inherits the alert discipline

Same rules as the settlement alerts, for the same reasons:

- **Unknown is not fine.** A drift metric that could not be computed is a
  `could-not-check` finding, never a clean reading. The provider-lag alert ran
  as "unknown" for exactly as long as its number genuinely could not be
  computed, and said so.
- **Derived at read time, never stored.** A persisted alert can disagree with
  the condition it describes.
- **Thresholds guarded by minimum samples.** Three bad outcomes out of four is
  a quiet Tuesday, not an incident — the mass-void alert's sample floor applies
  here unchanged.

## What is built and what is not

**Built:** the registry state machine with its refusals, the calibration drift
guard, CLV and rolling-Brier series in `advancedMetrics.ts`, the alert
discipline and its exit-code contract.

**Not built:** the drift computations themselves (feature and prediction drift
need a persisted feature store to diff against — the table now exists, the
writer does not) and the scheduled job that walks approved models through these
checks. Stated so this page cannot be read as a description of a running
monitor.
