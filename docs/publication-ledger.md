# The publication ledger

*Schema: [`20260731163545_publication_ledger.sql`](../supabase/migrations/20260731163545_publication_ledger.sql).
Read contract: [`src/lib/domain/canonicalReads.ts`](../src/lib/domain/canonicalReads.ts).*

## What it is

One table, `op_publications`, holding every official OddsPadi public pick, with
two companions: `op_publication_revisions` (append-only prior states) and
`op_publication_settlements` (idempotent verdicts, one current per pick).

Every public count on the site — homepage, Track Record, results, performance,
weekly recaps, news — resolves to this ledger through `readOfficialPerformance`.
There is no second source, and pages may not reconstruct counts from
operational tables.

## What a publication record must carry

A claim that cannot be audited is indistinguishable from an invented one, so
each row records the whole basis of the claim:

- **Identity** — publication id, fixture id + external id, sport, competition,
  market, selection, selection label, market line.
- **Provenance** — model version, feature-set version, calibration version,
  decision-policy version. Four independently versioned inputs, because the
  same probability under a different calibration is a different claim.
- **The claim** — model probability, odds at publication, implied probability.
- **Time** — published at (server-generated), kickoff at, evidence cutoff at,
  odds snapshot at + snapshot id.
- **Condition** — data quality, decision status, public copy reference.
- **Lifecycle** — publication status, settlement status, settled at,
  correction reason, superseded publication, revision number.

## The invariants, and where they live

All of these are enforced in PostgreSQL, not only in application code, because
an application-side rule is a rule until someone writes a second code path.

| # | Rule | Mechanism |
|---|---|---|
| 1 | No pick may be created at or after kickoff | `check (published_at < kickoff_at)` |
| 2 | A published claim cannot be edited in place | `guard_publication_immutability` trigger |
| 3 | Corrections create a revision | `op_correct_publication()` is the only path |
| 4 | The original stays auditable | revisions table is append-only by trigger |
| 5 | Publication timestamps are server-generated | `default now()` |
| 6 | No invented historical timestamps | reconciliation refuses undated rows |
| 7 | A result cannot rewrite probability or odds | immutability trigger covers both |
| 8 | Settlement is idempotent | same verdict twice returns the existing row |
| 9 | At most one current settlement | partial unique index `where is_current` |
| 10 | Void/push/cancelled ≠ loss | separate settlement states; excluded from the accuracy denominator |
| 11 | Only official picks count publicly | `check (record_class = 'official_public_pick')` |
| 12 | Articles cite publication ids | story `claim` column, re-resolved at render |
| 13 | Community picks stay separate | different tables, different leaderboard |
| 14 | Backtests never enter live performance | different tables; performance page separates them |
| 15 | Shadow decisions are never public picks | class allowlist + mirror trigger allowlist |

### Verified, not asserted

Every invariant above was probed against the production database inside a
transaction that was then rolled back:

```
PASS post-kickoff-rejected      PASS shadow-rejected
PASS valid-publish              PASS inplace-edit-rejected
PASS correction-preserves-original (0.5 retained in revision, 0.61 applied)
PASS settlement-idempotent      PASS settlement-supersede-void-distinct
PASS revision-append-only
```

The probe found a real bug: `op_settle_publication` inserted the replacement
settlement before retiring the previous one, colliding with the
one-current index. Corrected forward in
`20260731163713_publication_ledger_settlement_supersede_order.sql`.

## Deleting is not possible, by design

The append-only guard on revisions blocks cascade deletes, so a publication
that has ever been corrected cannot be removed from the database at all.
Withdrawal is expressed as `retracted`, which keeps the row visible for audit
while excluding it from the record in both directions.

## Reading the ledger

```ts
import { readOfficialPerformance } from "@/lib/domain/canonicalReads";

const performance = await readOfficialPerformance({ sport: "football" });
if (performance.availability === "unavailable") { /* say so; do not show 0 */ }
```

`accuracy` and `roi` are `null` — never `0` — when nothing has been decided.
A model with no settled picks has no accuracy, and rendering 0% is a claim.

## Current state

As of the 2026-07-31 reconciliation: **0 official publications.** OddsPadi has
never published a pick that meets this bar. Every public surface now says so
consistently, which is the first time the product has been internally
consistent about its own record.
