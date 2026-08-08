# Model dataset versioning

*Implementation: [`datasetVersion.ts`](../src/lib/features/datasetVersion.ts).*

**Reproducible** means: given this identifier, you can rebuild the exact rows a
model was trained on and get the same numbers. Nothing weaker counts. A model
whose training set cannot be rebuilt cannot be audited, and a claim that cannot
be audited is a claim on trust alone.

## The five components

| Component | Pins |
|---|---|
| `rawReceiptSetId` | What the providers actually sent |
| `normalisationVersion` | How receipts became rows |
| `labelDefinitionVersion` | What counted as a win |
| `featureSetVersion` | What was computed from the rows |
| `windows` | Which rows were train, validation and holdout |

Leaving any one out makes the other four useless.

**Labels are the one people forget.** Change the settlement basis — regulation
versus post-shootout, say — and every metric moves without a single feature or
a single row changing. That is why `labelDefinitionVersion` is the settlement
rule version, and why the dataset id changes when it does.

## The id

A content hash over the five, with a fixed key order rather than object
insertion order, so two callers building the same dataset differently still get
the same id.

## Chronological honesty

Random splits are the standard way to get a good number from a time series and
learn nothing: tomorrow's match teaches the model about yesterday's, and the
score measures memorisation.

`validateWindows` refuses:

| Defect | Why it matters |
|---|---|
| `overlap` | The model is scored on rows it trained on |
| `holdout_not_last` | The holdout no longer simulates deployment |
| `out_of_order` | The split is not chronological at all |
| `empty` | A window that is inverted or zero-length |

The holdout must sit after **both** other windows. It is the only part of the
split that answers "what would this have done in production", and it is the
only part that is spent once.

## Reproduction

`checkReproduction` compares component by component, not only the id, because
*"the ids differ"* tells an operator nothing about which of the five moved —
and in practice it is nearly always the labels.

Every mismatch is reported, not just the first.
