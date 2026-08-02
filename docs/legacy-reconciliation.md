# Legacy reconciliation

*Command: `npm run ops:reconcile-ledger` →
[`scripts/reconcile-publication-ledger.mjs`](../scripts/reconcile-publication-ledger.mjs).
Latest output: [legacy-reconciliation-report.md](legacy-reconciliation-report.md).*

## The question it answers

Before the ledger existed, prediction-like rows lived in a dozen stores. Which
of them, if any, can OddsPadi honestly claim as an official public pick?

## The bar for recovery

A legacy row becomes an official publication only if **all** of the following
can be shown from stored data:

1. it came from `op_public_picks` — the only store that ever meant "we showed
   this to the public";
2. its publication timestamp is strictly before the fixture's kickoff;
3. it resolves to a canonical fixture;
4. it has a market, a selection, and a plausible price at publication.

Anything failing any test is classified non-official and reported. Nothing is
inferred, back-dated, or reconstructed. **An unprovable pick is not a pick.**

Where legacy rows predate per-component versioning, the recovered record stores
`legacy-unknown` rather than a plausible-looking version string. Recording that
we do not know beats inventing provenance.

## Result of the 2026-07-31 run

| Measure | Value |
|---|---|
| Total legacy objects inspected | 1,083,525 |
| **Official picks recovered** | **0** |
| Internal decisions | 1,083,163 |
| Shadow decisions | 328 |
| Backtest records | 25 |
| Editorial observations | 8 |
| Simulations | 1 |
| Community selections | 0 |
| Records missing timestamps | 0 |
| Records missing odds | 0 |
| Records missing fixture identity | 0 |
| Records requiring manual review | 0 |
| Conflicting settlements | 0 |

Zero recovered is not a failure of the tool. `op_public_picks` is empty and
always has been: publication has never opened, because the model has never
passed all seven promotion gates. The 144 rows that were appearing as a public
track record were 143 paper-mode shadow runs and one developer smoke test,
reaching an anon-readable table through a mirror trigger that used a denylist.

The counts for the two largest stores are planner estimates, marked `≈` in the
report: an exact count over 590k rows exceeds the API role's 8-second statement
timeout. An estimate labelled as an estimate is honest; dropping the row or
printing zero would not be.

## Re-running

Safe at any time. Classification is derived, and recovery is keyed on the
source record, so a second run inserts nothing new.

```bash
npm run ops:reconcile-ledger -- --report docs/legacy-reconciliation-report.md
```

Add `--commit` to write recovered publications. Without it, the command reports
what it *would* recover and writes nothing.

## The tool refuses to lie

If any store read fails, the command exits non-zero and prints which store
failed, instead of emitting a report. This exists because the first run did
exactly the thing this whole project is about: an auth error produced a tidy
table of zeros that looked like a finding. An audit that cannot read its
sources has no findings, only an outage.

## What was changed to the data

- Every row in `op_public_prediction_outcomes` was labelled with its true
  record class (143 `shadow_decision`, 1 `simulation`). **No rows deleted** —
  they remain honest shadow evidence, now unusable as public performance.
- The mirror trigger became an allowlist, so a new source is withheld by
  default rather than published by default.
- Three `op_weekly_prediction_recaps` rows were removed. They were a derived
  cache of the shadow rows — a graded count, an accuracy and an ROI that no
  published pick stood behind. They were deleted rather than corrected because
  there is no official data from that period to correct them *to*; the honest
  value is "nothing published yet".
