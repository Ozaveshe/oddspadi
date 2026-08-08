# Model promotion

*Gates: [`promotionGate.ts`](../src/lib/model/promotionGate.ts).
Validation: [`walkForward.ts`](../src/lib/model/walkForward.ts).*

A candidate replaces the champion only when every gate passes. Ten gates, and
two properties matter more than the list.

## An unevaluable gate does not pass

The most expensive failure in a promotion pipeline is not a bad model getting
through. It is a gate that **cannot be evaluated** returning "no objection".

This repository has already shipped that shape: settled outcomes carried no
model key, so no calibration profile could ever be attributed, and the
promotion path reported clean the entire time it was structurally incapable of
promoting anything.

So `unknown` is a distinct verdict from `pass` and `fail`, and it blocks. A
missing measurement is a reason to stop, not an absence of objection.

## Every failure names itself

*"Promotion blocked"* tells an operator to re-run it. *"Promotion blocked:
calibration ECE 0.087 above the 0.05 ceiling"* tells them what to fix.
`explainPromotion` separates failures from unevaluable gates, because those
need different actions.

## The gates

| Gate | Passes when |
|---|---|
| `leakage` | No feature leaked past the decision cutoff |
| `reproducibility` | The training dataset rebuilt to the same identifier |
| `sample` | The holdout has at least 500 graded outcomes |
| `brier` | Not worse than champion by more than 0.002 |
| `log-loss` | Same tolerance |
| `calibration` | ECE at or below 0.05 |
| `segments` | No measurable segment regressed beyond 0.02 |
| `clv` | Mean CLV ≥ 0 over at least 30% coverage |
| `latency` | p95 at or below 2500ms |
| `operations` | No regression observed while shadowing |

## Decisions worth defending

**Non-inferiority, not a strict win.** A candidate that ties on Brier while
being simpler, faster or better calibrated is a legitimate promotion. Demanding
a strict improvement selects for overfitting to the holdout, which is the one
set you cannot spend twice.

**A leaked evaluation is invalid, not optimistic.** It does not get a
discount — it gets rejected, because the number describes a capability the
model will never have.

**No segment may collapse.** An aggregate gain built from a large improvement
on football and a large loss on tennis is not an improvement; it is a model
that got worse at something a reader will still be shown. Segments below 100
outcomes are ignored rather than failed — they cannot demonstrate a regression.

**CLV is judged on coverage before magnitude.** A +4% mean over eleven covered
picks out of four hundred is unevaluable, not a pass. Treating it as one is how
a pipeline learns to prefer whichever model happened to get its closes
captured — and with measured closing coverage where it currently is, that
matters enormously. See
[closing-price-policy.md](closing-price-policy.md).

## Walk-forward validation

Random splits measure memorisation. Tomorrow's match teaches the model about
yesterday's, the score looks excellent, and it describes nothing the model can
do in production.

Every production claim comes from rolling-origin folds: train on everything
before a point, score the window after it, roll forward. Each fold is a small
simulation of deployment.

**The embargo is not cosmetic.** A result settles hours after kickoff and a
correction can arrive days later, so a test window beginning the instant
training ends can score rows whose labels were still moving. The embargo is how
long a label takes to stop changing.

**A final short fold is dropped, not truncated.** A fold scoring three days
against everyone else's thirty is not comparable, and averaging it in is a
quiet distortion.

**Both means are reported.** Weighted by sample and unweighted. A large gap
between them says the result depends on one busy fold — precisely what an
average is best at hiding. The worst fold is named too, because a mean cannot
show you a collapse.

## Rollout

Promotion is staged and reversible: shadow → staged rollout → full. A degraded
model abstains rather than continuing to publish, and rollback targets the
prior approved version rather than "the last thing that worked".
