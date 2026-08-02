# Incident response and rollback

Six subsystems, each with a different reversal path. The common principle: no
rollback destroys evidence. A bad publication is retracted, never deleted; a
bad projection is superseded, never truncated.

## 1. Schema migration

Migrations are forward-only. There are no `down` scripts, deliberately — a
reverse migration written months earlier and never executed is not a rollback
plan, it is an untested script that runs during an incident.

**To reverse:** write a new forward migration that undoes the change, and apply
it the same way. Name it for what it undoes.

**Before applying anything destructive:** additive changes (new column, new
table, new index) are safe to apply ahead of the code that uses them.
Destructive ones (drop, rename, narrow a check constraint) must be split:

1. Ship the additive half and the code that tolerates both shapes.
2. Verify in production.
3. Ship the destructive half in a later release.

A rename is a drop plus an add. Treat it as destructive.

## 2. Read-model projection

The safest rollback in the system, because the projection store never
overwrites good data with empty.

**To roll back a builder change:** lower `SUPPORTED_BUILDER_VERSION` in
`src/lib/readmodel/publicProjection.ts` and deploy. Readers immediately refuse
the new payload shape and fall back to the last payload they understand.

**If a refresh is writing bad payloads:** stop the sweep first
(`netlify/functions/projection-refresh-sweep.ts`), then roll the reader back.
Rolling the reader back while the sweep still runs means the sweep keeps
overwriting rows the reader cannot use.

**Never** truncate `op_public_projections`. The last good payload in each row
is the fallback; deleting it turns a degraded page into an unavailable one.

## 3. Match page

The match page renders from one view-model, `buildMatchIntelligence`. A bad
change shows up as a contradiction rather than a crash, which is why the
cross-surface suite exists.

**To roll back:** revert the commit. There is no data migration behind the
match page — it is a pure function of the fixture, odds, model run and
publication.

**To verify a rollback worked:** run
`npx vitest run src/test/cross-surface-consistency.test.tsx`. If the match page
disagrees with the listings again, the revert was incomplete.

## 4. Publication ledger

**Publications are immutable.** There is no update path and no delete path;
Postgres enforces this.

| Situation | Action |
|---|---|
| The claim was wrong | Insert a `corrected` publication with `supersedes_publication_id` set. Both remain readable. |
| The claim should never have been made | Set `publication_status` to `retracted` with a `correction_reason`. It leaves the record but stays visible. |
| The settlement was wrong | Insert a new settlement row; the partial unique index retires the previous one. Never edit the existing row. |

**Do not** repair the ledger to improve reported performance. The reconciler
reports; a human decides; the correction is appended. A ledger that can be
quietly edited is not a track record.

## 5. Settlement process

Settlement is idempotent — re-running it produces the same verdict from the
same inputs.

**If settlement graded wrongly at scale:** stop the outcome-ledger sweep, fix
the grading rule, then re-run. The new settlements supersede the old ones and
both remain in `op_publication_settlements`.

**If a provider corrected a final score:** that is a fixture correction, not a
settlement bug. Let the fixture update, then re-run settlement for the affected
window.

**Abandoned fixtures void.** They do not grade against a partial scoreline —
enforced in `src/lib/sports/results/settlement.ts`. If abandoned matches start
appearing as won or lost, that branch has been removed or the provider status
is no longer mapping to `abandoned`.

## 6. Engine version

**To roll back a model:** the decision policy reads a model version; point it
at the previous approved version. Decisions generated under the bad version
remain in `op_market_decisions` labelled with it, so the affected set is
identifiable by query rather than by guesswork.

**Published picks made under a rolled-back model are not retracted
automatically.** A model being withdrawn does not make a specific claim wrong,
and mass-retracting to tidy the record is exactly the optimisation this system
forbids. Review them individually.

## Triage order during an incident

1. **Is the public site lying?** A contradiction is worse than an outage,
   because an outage is visibly an outage. Roll back the read path first.
2. **Is anything writing?** Stop the sweeps before diagnosing. A job retrying
   into a broken state widens the blast radius.
3. **Is the ledger touched?** If yes, stop and get a second pair of eyes. Ledger
   damage is the only category here that is not cheaply reversible.
4. **Then** diagnose.

## After an incident

Add the case to `src/test/prohibited-contradictions.test.tsx` or the coherence
model in `src/lib/domain/stateMatrix.ts`, whichever can actually represent it.
A rule in the coherence model is stronger: it makes the state unrepresentable
rather than merely detected.
