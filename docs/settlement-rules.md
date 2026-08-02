# Settlement rules

*Implementation: `op_settle_publication()` in the ledger migration;
grading logic in [`marketDecisionSettlement.ts`](../src/lib/sports/results/marketDecisionSettlement.ts);
aggregation in [`canonicalReads.ts`](../src/lib/domain/canonicalReads.ts).*

## What settlement is

Turning a finished fixture into a verdict on a publication. It is a separate
object from the publication itself, because a verdict can be revised and a
claim cannot.

## The states

| State | Meaning | Counts in accuracy? | Counts in ROI? |
|---|---|---|---|
| `unsettled` | Fixture not finished, or not yet graded | No | No |
| `won` | Selection resolved in favour | Yes | Yes (+odds) |
| `lost` | Selection resolved against | Yes | Yes (−1 unit) |
| `push` | Stake returned (exact line) | No | No |
| `void` | Market never resolved | No | No |
| `cancelled` | Fixture cancelled | No | No |
| `pending_verification` | Grading needs a human | No | No |

Only `won` and `lost` enter the denominator. A push returned the stake and a
void never ran; counting either as a played pick misstates the record.

## Rules

1. **Idempotent.** Settling the same publication with the same verdict twice
   returns the existing settlement and writes nothing. A duplicated settlement
   job therefore cannot double-count a result — the property most likely to
   silently inflate a record.
2. **Supersede, never overwrite.** A changed verdict inserts a new settlement,
   retires the previous one (`is_current = false`, linked forward via
   `superseded_by_settlement_id`), and leaves it readable.
3. **Exactly one current.** A partial unique index enforces it continuously,
   so no window exists in which two verdicts are both live.
4. **A retracted publication cannot be settled.** Withdrawn claims do not
   acquire results afterwards.
5. **Settlement never rewrites the claim.** Probability, odds and timestamps
   are immutable after publication; only the verdict moves.
6. **Ungradeable stays ungradeable.** A market a final score does not fully
   determine returns `needs_review` → `pending_verification`, never a guess. A
   wrong label is worse than an absent one because it silently corrupts the
   calibration curve.
7. **`settled_at` matches the state.** A settled row must have a timestamp; an
   unsettled or pending-verification row must not — enforced by check
   constraint.

## Order of operations in the hourly sweep

1. Mark closing odds for fixtures whose kickoff has passed.
2. Grade market decisions against final scores (internal evidence).
3. Backfill prediction outcomes.
4. Prune superseded odds snapshots.

Official publications settle through `op_settle_publication()`. The sweep is
bounded per pass and resumes on the next run; see
[oddspadi v1.6 automation](product-architecture.md) for the scheduling
constraints that shape it.

## What settlement must never do

- Infer a result from a missing score.
- Convert a void into a loss (or a win) to simplify a denominator.
- Settle a publication that was never published before kickoff.
- Write a verdict for a community tip, backtest or shadow run into the
  official ledger.
