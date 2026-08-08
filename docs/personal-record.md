# Personal record

The user's own analytical history: what they selected, what happened, and
what one unit staked would have returned — kept firmly apart from official
model performance.

## Where it comes from

The record is **derived, never separately stored**
(`src/lib/personal/record.ts`). Settled Bet Workspace snapshots are the
source: each frozen leg with a settlement outcome becomes a record entry
carrying the selection, the fixture, the user's odds, the outcome (full
canonical vocabulary including half wins and half losses), the one-unit
result, and the user's private note. Guest and account mode read the same
data — workspaces — so the record needs no migration of its own and
deleting a workspace deletes its history.

## What is shown

- The entries themselves, paginated (10 per page).
- Settled / won / lost counts and the signed one-unit total.
- Sport and market breakdowns.
- The current streak over decisive outcomes — pushes and voids neither
  extend nor break it.
- Personal notes, which never leave the device or the private sync row:
  the share sanitiser's field whitelist excludes them.

## The separation rule

Personal results and official model ROI never blend. Different selections,
different prices, different discipline — a user who beat their book says
nothing about the model, and the model's record says nothing about the
user. Every surface showing personal results renders
`PERSONAL_RECORD_SEPARATION_COPY` verbatim, settlement responses carry
`PERSONAL_RECORD_COPY`, and the record-class taxonomy files personal
selections as `community_selection`, which `countsTowardRecord` ignores.
Tests pin the copy and the workspace module's inability to write official
tables.

## Settlement integrity

Outcomes come from `/api/workspace/settle`: verified canonical results
only, graded by the same engine that settles official publications. A leg
whose market has no canonical mapping reports "cannot be graded" rather
than a guess, and stays out of the one-unit total.
