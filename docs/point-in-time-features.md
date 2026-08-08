# Point-in-time features

*Implementation: [`pointInTime.ts`](../src/lib/features/pointInTime.ts).
Tests: `point-in-time-leakage.test.ts`.*

## The failure this prevents

A model claim is worth what the data behind it was worth **at the moment the
decision was made**. Every backtest that has ever flattered a model did it the
same way: a feature computed from something that had not happened yet.

The failure is silent by construction. A leaked feature does not error, does
not look wrong, and improves every metric. That is precisely why it must be
made structurally impossible rather than reviewed for — a review looks for
mistakes, and this one looks like success.

## A feature is not a number

It is a number plus the timestamps that say when it could have been known:

| Timestamp | Answers |
|---|---|
| `eventAt` | When the thing it describes happened |
| `sourcePublishedAt` | When the source published it |
| `retrievedAt` | When we fetched it |
| `calculatedAt` | When we computed the value |
| `validFrom` / `validUntil` | From when this revision is the right one to read |

Plus `featureVersion`, `confidence`, and `missingReason`.

A feature that cannot answer these is not admissible. Not "flagged" — not
usable.

## The leaks, named

Named individually rather than collapsed into "future data", so a detection
reads as a diagnosis rather than an alarm.

| Kind | The tell |
|---|---|
| `event_after_cutoff` | The final result used as an input |
| `source_published_after_cutoff` | A closing price, or a lineup released after the cutoff |
| `retrieved_after_cutoff` | A later injury report reaching an earlier decision |
| `calculated_after_cutoff` | The feature was computed with hindsight |
| `value_not_yet_valid` | A corrected revision read into a decision predating the correction |
| `target_event_included` | An aggregate window containing the match being predicted |

**All checks run; none short-circuits.** A feature leaking three ways is a
different problem from one leaking once, and knowing which is how you find the
source.

### The subtle one

`target_event_included` is the only leak no timestamp reveals. A "last ten
matches" form figure computed before kickoff is entirely legitimate — unless
the ten include this one. Every timestamp on the feature is correct; only its
*membership* is wrong. It needs its own check because nothing else can see it.

## Refuse, never repair

A leaked feature is not clamped to the cutoff and not down-weighted. The value
was computed from information that did not exist, so there is no correct number
to fall back to. `admitFeature` returns the findings and no feature at all.

## Missing is not zero

Zero is a real value in every feature space here — zero goals, zero rest days,
zero rating. Substituting it makes *we do not know* indistinguishable from *we
measured nothing*, and the model learns from the difference.

Three policies, all of which state themselves:

| Policy | Behaviour |
|---|---|
| `explicit_null` | Carry the null through; the model handles it |
| `sport_prior` | Substitute a stated assumption, marked `substituted: true` |
| `abstain` | Produce no decision |

A null with no `missingReason` is itself a finding, because the moment it
reaches a model it is indistinguishable from a zero.

## Auditing a set

`auditFeatureSet` separates three outcomes deliberately:

- **admitted** — usable
- **rejected** — leaked; the run is invalid
- **missing** — absent with a stated reason; the run is merely limited

Folding rejected and missing together loses the distinction that decides
whether a model run is limited or actually invalid. `clean` is true only when
nothing leaked — missing features notwithstanding.
