# Result verification

*Implementation: [`verification.ts`](../src/lib/results/verification.ts).
Storage: `op_fixture_results`. Model:
[`canonicalResult.ts`](../src/lib/results/canonicalResult.ts).*

## The distinction this exists to make

Settlement used to read the provider's status directly, which made "the
provider said finished" and "we know what happened" one statement. They are
not. A provider can report a terminal status with a partial score, revise a
score an hour later, or report a fixture finished that a second observation
contradicts.

`op_fixtures.status` stays the provider's last word. `op_fixture_results`
carries our reading of the evidence. When they disagree, the disagreement is the
finding — the same arrangement `lifecycle_state` already uses.

## Why a separate table

`op_fixtures` is upserted on every results refresh. Verification state and
correction history cannot survive in a row that ingest overwrites.

It also stores only `home_score` and `away_score`, which is the deeper problem:
a cup tie decided on penalties has no recoverable normal-time score, so football
1X2 was settling against a post-shootout result. Silently, on a public record.

## Score basis, declared

| Column | Means |
|---|---|
| `regulation_*` | The score at the end of normal time |
| `extra_time_*` | The score at the end of extra time, **inclusive of regulation** (API-Football's `score.extratime` convention) |
| `shootout_*` | Penalties alone, exclusive of everything before them |

Stated in the column comments because a reader who has to work out whether
`extra_time` includes regulation will eventually work it out wrong. A check
constraint enforces `extra_time >= regulation`, which the convention implies.

Football 1X2 reads `regulation_*`. Nothing else does.

## The ladder

| State | Meaning | Settleable |
|---|---|---|
| `provisional` | Provider reports terminal; conditions not yet met | **No** |
| `verified` | Terminal status, score complete for this sport's markets, and either two agreeing primary observations ≥10 minutes apart or an agreeing secondary source | Yes |
| `conflicted` | Observations disagree | No |
| `manual_review` | Needs a human | No, until an operator verifies |

"Do not settle on a provisional score" is enforced by the settlement query
reading only `verified` — a filter, not a rule anyone has to remember at each
call site. `grade.ts` refuses any non-verified result regardless of what the
score says.

### What counts as complete

Football and basketball need a regulation score. Tennis needs an awarded
winner, because it grades from the award and the set/game counts rather than
from a goal score. A postponed or cancelled fixture legitimately has no score,
so completeness is not asked of it.

### Conflict outranks agreement

Any disagreement between observations is a conflict. Majority is deliberately
not the rule: two sources agreeing against a third does not tell us which is
right, and picking the majority would settle a claim on a vote rather than on
evidence.

The live event stream (`op_live_match_events`) is checked as a third signal
where it exists — against the score, not over it. A mismatch means one of the
two is wrong and we do not know which, so it conflicts.

### Provisional does not last forever

A fixture holding one stable, uncontradicted observation for six hours will
never acquire a second — the provider has said its last word. Left
`provisional` it would trip the unverified SLA alert on every sweep
indefinitely, and an alert nobody can clear is an alert everybody learns to
ignore.

So it escalates to `manual_review` with
`detail.reason = 'single_observation_timeout'` and an operator resolves it.

## The secondary source

`ResultSource` is an interface. One implementation is registered today:
re-observation of the primary provider at a later time. A licensed second
provider is a new implementation and no schema change — which is the whole
reason it is an interface rather than a provider name threaded through the
verifier.

## Corrections

A provider revising a score writes revision N+1, retires N through
`superseded_by_result_id`, and enqueues a re-settle. The re-settle supersedes
the verdict through the existing `op_settle_publication()` path.

Publication evidence is structurally safe rather than protected by convention:
settlement writes only to `op_publication_settlements`, and no code path writes
to `op_publications`.

A partial unique index enforces one current result per fixture continuously, so
no window exists in which two results are both live.

## What verification must never do

- Repair a score. An unverifiable result stays unverifiable, and somebody is
  told.
- Resolve a conflict by choosing. A conflict is a fact about our evidence.
- Treat `abandoned` and `retired` as the same thing. An abandoned match stopped
  without a result; a retirement produces an awarded winner that some markets
  settle on. Collapsing them is how a played match becomes a void.
