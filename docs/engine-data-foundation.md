# Engine data foundation

The contract between the data and any claim built on it.

*Point-in-time: [point-in-time-features.md](point-in-time-features.md).
Quality: [data-quality-model.md](data-quality-model.md).
Odds: [historical-odds.md](historical-odds.md).
Reproducibility: [model-dataset-versioning.md](model-dataset-versioning.md).*

## The principle

Model complexity must not outrun data integrity. A sophisticated model on
leaked or unverifiable data produces confident numbers that mean nothing, and
the sophistication makes the failure harder to see rather than easier.

So the foundation comes first, and it is built out of refusals:

| Refusal | Where |
|---|---|
| A feature that cannot say when it was knowable is inadmissible | [point-in-time-features.md](point-in-time-features.md) |
| Bad data is quarantined, never repaired | [data-quality-model.md](data-quality-model.md) |
| A missing value is never zero | [point-in-time-features.md](point-in-time-features.md) |
| A line is reported unrecoverable, never guessed | [historical-odds.md](historical-odds.md) |
| A dataset that cannot be rebuilt is not a dataset | [model-dataset-versioning.md](model-dataset-versioning.md) |

## Coverage, measured

Numbers from production on 2026-08-08. They are results, not targets, and
several of them are uncomfortable — which is the point of writing them down.

| Fact | Value |
|---|---|
| Odds snapshots | 1,898,349 |
| Of which `match_winner` | 1,888,379 (99.5%) |
| Snapshots with a recoverable line | 1,144 |
| Closing-window depth ≥ 3 books | 1.6% |
| Closing-window depth = 1 book | 84.7% |
| Depth ≥ 3 at six hours out | 31.6% |

Two readings follow. The market breadth is real — fifteen books quote these
fixtures, Pinnacle among them. And the capture cadence does not survive
contact with kickoff, which is a collection problem rather than a market one.

## Identity

A model run must not reach publication when identity confidence is below the
approved threshold. A claim attached to the wrong fixture is worse than no
claim: it is wrong *and* it looks like coverage.

Identity is validated at ingest (`reversed_participants`,
`duplicate_fixture`) and again at settlement, where a claim whose participants
cannot be resolved raises `missing_participant_identity` rather than settling.

## What is built and what is not

**Built and tested:** the point-in-time contract with six named leaks, the
ingestion checks with three dispositions and no repair path, dataset versioning
with chronological window validation, the historical-odds schema with line,
class and outlier state.

**Not built:** the feature store as a persisted table — the contract exists in
code and nothing writes it yet; the full coverage matrix by sport, competition,
season, market, provider and feature; ratings, rest and travel features.

That distinction is stated here rather than left implicit, because a document
describing a foundation reads as a claim that the foundation exists.
