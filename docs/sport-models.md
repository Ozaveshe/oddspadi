# Sport models

*Frame: [model-lab.md](model-lab.md). Promotion:
[model-promotion.md](model-promotion.md).*

What each sport's candidates are evaluated from, and the constraints that hold
whatever the model class. **None of these candidates is trained yet** — this
document is the evaluation slate, and it says so to avoid reading as a claim
that the models exist.

## Football

**Candidates:** Elo or dynamic team strength, Poisson score models with the
Dixon–Coles low-score adjustment, attack/defence strength, expected goals where
licensed, home advantage, opponent-adjusted form, rest and congestion, travel,
lineup availability, competition strength, and a market-consensus prior.

**Constraint:** 1X2 probabilities must sum to one — coherence is asserted by
the match-page suite, not hoped for. Labels settle on **normal time**
([market-settlement-rules.md](market-settlement-rules.md)); a model trained on
post-shootout labels learns the wrong game, which is exactly the label-version
trap [model-dataset-versioning.md](model-dataset-versioning.md) exists for.

## Basketball

**Candidates:** possession-based offensive and defensive efficiency, pace,
margin distributions, rest and back-to-backs, travel, home advantage, lineup
availability, competition strength, market prior.

**Constraint:** the full-game market has no draw; regulation-only is a separate
three-way market. Labels are basis-specific, never shared between the two.

## Tennis

**Candidates:** surface-specific Elo/Glicko, serve strength, return strength,
opponent-adjusted form, fatigue, tournament level, best-of-three versus five,
retirement and availability history, market prior.

**Constraint:** **head-to-head is not overweighted.** H2H samples are tiny,
years-stale and surface-confounded — the classic feature that demos well and
generalises badly. And the training corpus is canonicalised so player_1 always
wins ([oddspadi-training-corpus](training-data-goal-2026-07-29.md) history); a
model fed it naively learns that player_1 wins. Features must be
orientation-symmetric.

## Model classes

Regularised logistic/multinomial regression, Poisson and count models, rating
models, gradient-boosted trees, hierarchical models. Neural models only where
data volume justifies them — with ~13.6k tennis and ~37k football matches, it
rarely does. **Complexity is not a success criterion**; a complex candidate
that cannot beat the transparent baseline on walk-forward folds is a finding
about the candidate.

## The ensemble

A versioned blend: independent sport model, statistical baseline, market prior,
calibration layer. Weights may vary by sport, market, competition, data
completeness, time to start, lineup availability and historical performance.

**A weak independent model never outweighs a strong market baseline.** The
market is a well-resourced opponent; a blend that systematically overweights
our own view is a preference, not a finding — and the measured history here
(+0.0055 Brier skill against the market on 2,292 outcomes) says the honest
starting weight for the independent view is small.
