# Data quality model

*Ingestion checks: [`ingestionValidation.ts`](../src/lib/features/ingestionValidation.ts).
Point-in-time: [point-in-time-features.md](point-in-time-features.md).*

Data quality is a statement about the **evidence**. Model confidence is a
statement about the **conclusion**. They are kept apart deliberately: a
confident model on thin evidence is precisely the state this product must be
able to name, and a single blended score makes it unsayable.

## Dimensions

| Dimension | Measures |
|---|---|
| Completeness | Fields present against fields expected |
| Timeliness | How recently the evidence was observed |
| Identity | Confidence the row is about the entity we think |
| Source depth | How many independent sources agree |
| Market completeness | Whether a market has all its selections |
| Feature freshness | Age of the computed value at the decision cutoff |
| Provider agreement | Whether sources contradict each other |
| Historical support | How much comparable history exists |

## Dispositions

Three, and none of them is "repair".

| Disposition | Meaning |
|---|---|
| `accept` | Usable |
| `quarantine` | Held out of the model, kept for evidence, surfaced to an operator |
| `reject` | Structurally impossible; kept only as a record of what the provider sent |

**A repair looks like a fix and behaves like a fabrication.** The row that
reaches the model is one nobody observed, and the evidence that anything was
wrong is gone. So a bad value is held, never rewritten.

The worst finding wins. A row both duplicated and impossible is rejected, and a
single `accept` among ten findings never rescues it.

## Checks

### Row level

| Check | Disposition | Why |
|---|---|---|
| `impossible_score` | reject | Outside the sport's plausible range — a parsing artefact, not an event |
| `reversed_participants` | reject | Both sides resolved to one team: an identity failure, not a fixture |
| `duplicate_fixture` | quarantine | Odds may be stranded on either row, so merging is an operator decision |
| `odds_below_evens` | reject | Implies no return on a winning bet |
| `incomplete_market` | quarantine | Cannot be de-vigged |
| `excessive_overround` | quarantine | A real quote, but not a fair reading of the market |
| `timestamp_after_event` | quarantine | A score before kickoff is a clock problem or a different fixture |
| `inconsistent_season` | quarantine | Season disagrees with the competition |

Plausibility scales by sport: 97 is absurd in football and unremarkable in
basketball.

### Batch level

These catch what no row check can — a row that is individually valid while the
dataset rots around it.

| Check | Why it is invisible per row |
|---|---|
| `suspicious_mass_nulls` | Every row is well-formed; the field is simply empty in most of them |
| `parser_drift` | Nothing errors, rows keep arriving, and a feature quietly stops existing |

`parser_drift` is the quietest failure in the system. It is detected by
comparing the field set a source produced last time against this time — a field
that disappears takes every feature built on it with it, silently.

## Quarantine

Quarantined data is **held, not deleted**. It stays readable so an operator can
see what the provider actually sent, which is the only way to tell a provider
bug from an ingest bug.

Findings surface through the same operations queue as settlement and closing
exceptions — one queue, because two backlogs means one of them gets forgotten.

## What this model must never do

- Repair a value so a batch passes.
- Substitute zero for a missing measurement (see
  [point-in-time-features.md](point-in-time-features.md)).
- Blend evidence quality into model confidence.
- Report a healthy overround on an incomplete market: two of three prices
  always sum below the ceiling, and reporting that as healthy hides the missing
  selection.
