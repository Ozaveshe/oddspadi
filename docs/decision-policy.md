# Decision policy

*Implementation: [`decisionPolicy.ts`](../src/lib/model/decisionPolicy.ts).
Uncertainty input: [calibration-and-uncertainty.md](calibration-and-uncertainty.md).*

From a calibrated probability and its context to one of six public states:
`pick`, `lean`, `watch`, `pass`, `withheld`, `unavailable`.

## The two organising rules

**An unread or failed input becomes Unavailable, never Pass.** A pass is a
conclusion — *we looked, and there is no value here*. Rendering a failed read as
a pass publishes a conclusion nobody reached. Every input is tri-state, and null
routes to `unavailable` before any threshold is consulted. This codebase has
been burned by error-becomes-empty often enough that the rule is structural.

**Edges are computed on the conservative bound, not the point estimate.** A
pick made on the point and defended with the interval is a pick made on
optimism. The point estimate decides nothing in this policy.

## The three negative states are three different facts

| State | Means |
|---|---|
| `unavailable` | No view exists — an input could not be read |
| `withheld` | A view exists and we refuse to act on it — stale price, thin market, unsupported calibration, odds outside the band |
| `pass` | A completed analysis: the market's number beats our conservative one |

Collapsing these is how a data outage reads as a slate of passes.

## Thresholds

Exposed, not buried: pick at +4 points of conservative edge, lean at +2, watch
at ≥ 0, readiness floor 0.5, odds band 1.20–6.00.

The longshot ceiling is not taste. This book measured what happens without one:
`argmax(model − market)` selected 25%-hit-rate longshots, and odds-based CLV on
them flattered a fiction. Thresholds are versioned
(`decisionPolicyVersion` on the model record) so a change is visible in the
data, and they may vary by sport, market, odds band and uncertainty — the
defaults are the floor, not the tuning.

**Hit rate is not the objective.** A policy tuned to hit rate migrates to heavy
favourites and dies by the margin. The objective is conservative edge over a
de-vigged market, verified later by CLV.

## Publication gates above the policy

The policy produces a decision; publication demands more: identity, time,
market freshness, model approval (`mayPublish` — only an `approved` registry
state), calibration, uncertainty, edge, EV, odds range, settlement support and
closing-capture readiness. The same rule governs them all: an unread gate is
`unavailable`, never a pass-through.
