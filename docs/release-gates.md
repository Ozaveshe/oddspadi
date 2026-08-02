# Release gates

`npm run gate:release` runs the checks. `-- --full` adds the ones that reach
production.

The gate reports three outcomes per stage — **PASS**, **FAIL**, **SKIPPED with
a reason** — and prints a separate list of checks the brief requires that this
repository cannot yet run. A gate that silently omits a stage produces a green
result nobody can interpret, so the omissions are printed as loudly as the
failures.

## What runs today

| Stage | What it proves | Command |
|---|---|---|
| Typecheck | App and test projects both compile | `npm run typecheck` (two passes) |
| Unit + domain contracts | 1,500+ tests including the coherence model | `npx vitest run` |
| Cross-surface consistency | Ten surfaces agree about one fixture | in the suite above |
| Prohibited contradictions | The thirteen forbidden states | in the suite above |
| Generated docs current | `state-test-matrix.md` matches the model | `scripts/check-generated-docs.mjs` |
| Build | A type-clean app can still fail to build | `npm run build` |
| Production reconciliation | Ledger vs results vs projections vs editorial | `npm run ops:reconcile-truth` |
| Production smoke | The deployed site answers and does not leak | `npm run ops:health` |

## What is NOT checked

Stated plainly because the brief asks for them and they do not exist yet.
Claiming them would be worse than the gap.

| Required | Status | What is missing |
|---|---|---|
| End-to-end tests | **Not implemented** | No browser driver in CI. The cross-surface suite renders real components server-side and asserts on their HTML, which covers rendered output but not navigation, hydration or client interaction. |
| Accessibility checks | **Not implemented** | No automated axe run. Some a11y assertions exist in `src/test/` but nothing sweeps a rendered page. |
| Visual regression | **Not implemented** | No snapshot baseline. The deterministic world factory makes this feasible now — stable fixtures exist — but no baseline has been captured. |
| Performance budget | **Partial** | `scripts/load-test-public-reads.mjs` measures p95, but no threshold fails a build. |

## Cross-surface consistency, specifically

This is the gate the brief is really about, so it is worth stating how it works
rather than only that it runs.

1. `src/lib/domain/states.ts` defines the five state dimensions.
2. `src/lib/domain/stateMatrix.ts` defines which combinations can coexist. The
   unconstrained cross-product is 7,350; the coherence rules leave 395.
3. `src/test/support/canonicalWorld.ts` builds one deterministic world per
   state cell — fixture, odds, decision, publication, settlement, view-model.
4. Every surface stamps a `SurfaceClaimMarker` into its own HTML.
5. `src/test/cross-surface-consistency.test.tsx` renders the real components,
   parses the claims back out of the rendered output, and requires them to
   agree on identity, score, status, publication, settlement, odds
   availability and staleness.

The markers are `hidden` divs carrying only states already visible to any
reader. They are in production HTML too, which is what lets the reconciliation
job check a live page rather than only a database row.

### It found something on the first run

The suite's first green-to-red was real. Provider status `ABD` (abandoned) was
resolving three different ways: `finished` on the live board
(`liveScoreBoard.ts`), `cancelled` in the canonical pipeline
(`providerBackedProvider.ts`, `providerSync.ts`). An abandoned match therefore
read "FT" on one surface and "Cancelled" on the others — and since a finished
match grades won/lost while an abandoned one voids, the two readings implied
different money.

`abandoned` is now a first-class status through the whole chain, with an
explicit void branch in `settlement.ts` so a partial scoreline is never graded
as a result.

## Feature flags and staged rollout

High-risk migrations use the projection store as the rollout boundary:

- A new builder version writes under a new `builder_version`.
- `SUPPORTED_BUILDER_VERSION` in `src/lib/readmodel/publicProjection.ts`
  controls which version readers accept.
- Bumping the reader is the release; reverting it is the rollback. No data is
  destroyed either way, because the previous payload is still in the row.

See [incident-and-rollback.md](incident-and-rollback.md) for the per-subsystem
procedures.
