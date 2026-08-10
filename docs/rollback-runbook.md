# Rollback runbook

The operational "turn it back" procedure for a release. For the per-subsystem
reversal detail — schema, projection, match page, ledger, settlement, engine —
see [incident-and-rollback.md](incident-and-rollback.md). This runbook is the
order of operations and the deploy mechanics that sit on top of it.

## Deploy mechanics (know these before an incident, not during)

- **Netlify is git-linked.** Pushing `main` deploys. A rollback is therefore
  either a revert commit pushed to `main`, or a one-click "Publish deploy" of
  the previous good deploy in the Netlify UI. The UI restore is faster and does
  not require a green build — prefer it when the site is actively lying.
- **`main` lives in a Codex worktree**, not the primary checkout. Confirm which
  checkout you are on before pushing (`git remote -v`, `git branch --show-current`).
- **Migrations are forward-only and file-only in this session.** There is no
  `down`. A schema rollback is a new forward migration (see incident doc §1).
- **Config that is not a deploy:** feature reversals that ride environment
  variables (`SUPPORTED_BUILDER_VERSION` bump aside) take effect on the next
  function cold start, not instantly. Do not assume an env change is live.

## The decision tree

Run this top to bottom. Do not skip to diagnosis.

1. **Is the public site asserting something false?**
   A contradiction is worse than an outage. Roll the **read path** back first —
   revert the deploy (Netlify UI restore) or lower `SUPPORTED_BUILDER_VERSION`.
   Verify with `npx vitest run src/test/cross-surface-consistency.test.tsx`.

2. **Is anything writing?**
   Stop the sweeps before diagnosing — a job retrying into a broken state widens
   the blast radius. The scheduled writers:
   - `projection-refresh-sweep` (public read model)
   - `outcome-ledger-sweep` (settlement)
   - `production-reconciler-sweep` (alerts only — safe, but noisy during an
     incident; the reconciler **never** writes to a source table, so you do not
     need to stop it to protect data, only to quiet the exception queue)
   Stop a sweep by disabling its schedule / unpublishing the function.

3. **Was the ledger touched?**
   `op_publications` / `op_publication_settlements` are immutable and
   Postgres-enforced. If a release somehow wrote to them wrongly, stop and get a
   second pair of eyes — this is the only category that is not cheaply
   reversible. Corrections are **appended** (a `corrected`/`retracted` row), never
   edits. Never repair the ledger to improve reported performance.

4. **Then diagnose**, and only then.

## Reconciler-specific rollback

The production reconciler (`/api/cron/reconcile`) is **alert-only**: its sole
write is an `op_settlement_exceptions` row with `kind = reconciler_*`. There is
nothing to roll back in its outputs.

- **If it is producing false alarms:** the detection logic is pure and tested
  (`src/lib/reconciliation/detections.ts`). Fix the rule, add the case to
  `reconciler-detections.test.ts`, redeploy. Do not silence a detection by
  editing exception rows.
- **If it reports `could_not_check` (502):** a source read failed. This is the
  designed behaviour — it wrote **no** alerts rather than a false "clean". Treat
  it as a source-availability incident (which source is in the `couldNotCheck`
  list), not a reconciler bug.
- **To resolve open reconciler exceptions:** a human closes each case after the
  underlying mismatch is fixed at its source. Closing the exception is not the
  fix; correcting the source (or appending a ledger correction) is.

## Performance / budget rollback

- `src/lib/performance/routeBudgets.ts` holds the per-route p95/LCP/CLS/INP/bundle
  budgets. The load test (`scripts/load-test-public-reads.mjs`) fails when a
  route's p95 exceeds its budget.
- **If a legitimate change needs a temporary pass**, set `ODDSPADI_PERF_WAIVER`
  in the load-test environment — it is logged, not silent — and file the budget
  regression as a follow-up. Do **not** raise a budget to hide a regression;
  raising a budget is a deliberate, reviewed change to what "acceptable" means.

## After a rollback

1. Confirm the site is truthful again: cross-surface suite green, `/api/status`
   not `unavailable`, no open `reconciler_*` exceptions for the incident window.
2. Add the failure as a rule: a `prohibited-contradictions.test.tsx` case, a
   coherence-model exclusion (`stateMatrix.ts`, stronger — makes the state
   unrepresentable), or a new reconciler detection. A rolled-back incident with
   no new rule will recur.
3. Re-enable the sweeps you stopped, oldest-data-first, and watch the exception
   queue drain.
