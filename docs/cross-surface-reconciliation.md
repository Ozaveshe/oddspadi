# Cross-surface reconciliation

Two layers keep OddsPadi's surfaces telling the same story, and keep production
free of the contradictions that would let one lie.

## 1. Same-fixture agreement (CI-time)

Every surface that renders a fixture stamps a hidden `SurfaceClaim`
(`src/lib/domain/surfaceClaim.ts`). `reconcileClaims` groups claims by
`fixtureId` and fails if two surfaces assert **different** non-null values for
any agreement field: `fixtureStatus`, `score`, `publicationId`,
`publicationStatus`, `publishedAt`, `settlement`, `oddsAvailable`. A null field
is silence, not a counter-claim. `cross-surface-consistency.test.tsx` builds
one world per representative state cell and reconciles the rendered surfaces;
`reconcileCounts` does the same for count claims (article pick counts, etc.).

The coherence model (`src/lib/domain/stateMatrix.ts`) is upstream: it enumerates
which combinations of fixture/data/decision/publication/settlement are even
representable (407 of 9,450), so an impossible world cannot be built to render.

## 2. Prohibited contradictions (CI gate)

`prohibited-contradictions.test.tsx` fails CI for: past fixture current on
Today; expired price presented as current; no-value + actionable CTA; low/extreme
uncertainty without distinct definitions; no-odds + current-odds; failed-read +
zero; finished + pre-match action; settlement without publication; article count
without publication IDs; official/community/backtest mixing; the legacy
navigation shell; raw operational errors public; all-zero pre-season rank as
meaningful; demo counted as organic; public job endpoint; manually altered model
probability; and the reconciler-never-rewrites contract. Some are asserted here
directly; others are asserted-by-reference to the dedicated suite that enforces
them, so deleting that suite fails here too.

## 3. Production reconciliation (scheduled)

`src/lib/reconciliation/detections.ts` is the pure, tested detection engine for
eleven mismatch classes: publication/track-record, news/publication,
unsettled-final-fixture, stale-current-decision, missing-closing-price,
duplicate-fixture, result-conflict, orphaned-community-selection,
projection-age-breach, route-error-spike, model-version-mismatch.

`netlify/functions/production-reconciler-{sweep,worker-background}.ts` runs it on
a schedule (`8,38 * * * *`); the worker calls `POST /api/cron/reconcile`, which
reads the sources with the service role **read-only** and, for each finding,
writes one `op_settlement_exceptions` row via `op_record_settlement_exception`.

**Two contracts, load-bearing:**
- **Alert, never rewrite.** The only write is an alert row in the shared
  exception queue. No source table — and never an immutable publication — is
  corrected. A mismatch becomes a case for a human (see docs/staff — Prompt 21).
- **Never zero on failure.** An unreadable source makes the report
  `could_not_check` (502, no alerts written); it is never a false "clean".

The reconciler's exception rows carry `kind = reconciler_*` so the staff case
system can route them distinctly.

## Acceptance targets this system defends

100% official publication/count reconciliation; zero failed reads shown as zero;
zero past fixtures marked current; zero current actions on an expired price; zero
finished/pre-match contradictions; zero raw operational errors public; zero
unauthenticated operational mutations.
