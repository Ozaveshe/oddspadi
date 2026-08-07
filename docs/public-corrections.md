# The public correction log

*Read model: [`src/lib/publication/correctionLog.ts`](../src/lib/publication/correctionLog.ts).
Storage: `op_publication_revisions`, created in
[`20260731163545_publication_ledger.sql`](../supabase/migrations/20260731163545_publication_ledger.sql).
Tests: [`src/test/public-correction-log.test.ts`](../src/test/public-correction-log.test.ts).*

## Why this exists

The ledger has been able to correct a claim since the day it shipped:
`op_correct_publication()` copies the whole row into `op_publication_revisions`
before it changes anything, and the revisions table refuses updates and deletes
by trigger. So the audit trail was never in doubt.

What was missing is that nobody outside the database could see it. A record
that can be amended without the amendment being visible is not an auditable
record — it is a number that happens to be correct today, which is the same
thing a made-up number looks like from the outside. This module turns the
existing revision rows into something a reader can inspect.

Nothing here writes. The log is a projection of rows that already exist.

## A correction and a retraction

Both go through `op_correct_publication()`, both require a reason, and both
leave the prior state behind. They differ in what happens to the claim.

- A **correction** amends a claim that still stands. The probability was wrong,
  the price was captured from a stale snapshot, the published explanation named
  the wrong side. The pick is still ours and still counts.
- A **retraction** withdraws the claim entirely. It is called with
  `p_retract => true`, sets `publication_status = 'retracted'`, and takes the
  pick out of the record in **both** directions — it stops being a win and does
  not become a loss.

A retraction is not a deletion, and the schema does not offer one: the
append-only guard on revisions blocks the cascade, so a publication that has
ever been corrected cannot be removed from the database at all. Withdrawn picks
stay in this log forever. Disappearance is how a track record gets quietly
flattered, and it is the specific move this log makes impossible.

Settlement is a third thing and is not in this log. A re-graded result travels
through `op_settle_publication()`, which supersedes its own prior verdict and
keeps it linked and readable. See [settlement rules](settlement-rules.md).

## What each entry carries

| Field | What it is |
|---|---|
| `correctionId` | The revision row's id. Stable; an article may cite it. |
| `revision` | The revision number that this entry superseded. |
| `kind` | `correction` or `retraction`. |
| `correctedAt` | When the revision was written. |
| `reason` | The operator's reason. Mandatory — the RPC rejects an empty one. |
| `original` | The claim as it stood, parsed verbatim from `previous_state`. |
| `current` | What it became: the next revision's capture, or the live row. |
| `changes` | Field-level diff between those two, labelled for display. |
| `effect` | Win/loss/void counts and win rate, before and after. |

`original` is the whole point. The superseded probability, price and status
remain readable after the ledger row has moved on, so a reader can check what
was claimed rather than taking the current row's word for it.

## How the effect on aggregates is computed

Counts are walked **forward** from the state the ledger was in before any
correction landed, one correction at a time, in `created_at` order. Each entry's
`before` is therefore the record as it stood once every earlier correction had
been applied, and its `after` is the record immediately afterwards. The last
entry's `after` equals the ledger's current record — cross-checked against
`summarisePublications` in the tests, so the two cannot drift.

Two decisions are worth stating plainly.

**Only `publication_status` is varied.** Settlement is held at each
publication's current verdict throughout the walk. A correction cannot change a
verdict — the RPC only touches probability, odds, implied probability and the
copy reference — so attributing a scoring change to it would credit an editor
with a result they had nothing to do with. Holding settlement constant isolates
the correction's effect, which is the number this log is claiming to report.

The practical consequence: only a retraction can move the counts. A corrected
probability, price or explanation reports a zero delta on every count and
`movedTheRecord: false`. That is the honest answer, not an omission — the claim
changed and the record did not, and saying so is more useful than hiding the
entry.

**A missing rate is null, never zero.** `winRate` is `won / (won + lost)` and is
`null` when nothing has been decided. `winRateDelta` is `null` whenever either
side is `null`, because a move from "no rate" to "a rate" is not a numeric
difference and reporting it as one would show a jump from zero that never
happened.

Nothing recomputes history from fixtures, odds or model output. The only inputs
are the captured revision states and the current ledger row.

## Reading the log

```ts
import { readCorrectionLog, correctionLogStatement } from "@/lib/publication/correctionLog";

const log = await readCorrectionLog();
if (log.availability === "unavailable") {
  // We could not look. Do not render "no corrections".
}
correctionLogStatement(log);
```

`readCorrectionLog` issues two reads rather than a PostgREST embed — the
embedded-join form on this pair has been a reliable source of trouble, and the
revision table is small and append-only. A failed read returns `unavailable`
with the message and a `null` `currentAggregate`; it never returns an empty log.
"We found no corrections" and "we could not look" are the two states this
codebase most insists on keeping apart, and an outage that renders as a spotless
correction history is a false claim about our own honesty.

An empty log is a real and sayable result:

> No corrections have been issued. Every published claim stands exactly as it
> was first published.

That is a statement, not an error state, and it must render as one.

`unresolved` counts revision rows whose publication could not be read back — a
draft, or a claim outside the window asked for. Those are reported rather than
dropped, because a correction we cannot place is still a correction that
happened.

## No migration was needed

`op_publication_revisions` already stores everything a public log requires:
`reason` (non-null, and `op_correct_publication` rejects a blank one),
`previous_state` (`to_jsonb()` of the entire prior row), `revision` and
`created_at`. Its RLS policy is `for select using (true)`, so the rows were
already anon-readable — they were simply never read. Adding a second, "public"
reason column would have created two reasons that could disagree, which is the
class of problem the single ledger was built to end.

## Current state

As of 2026-08-07 production holds **230 publications, 134 settlements and 0
revisions**: nothing has ever been corrected, so the log is `confirmed_empty`.
It is built now so that the first correction is visible on the day it is made
rather than after somebody notices a number moved.
