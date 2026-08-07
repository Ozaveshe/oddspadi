# The public track record

*Page: [`src/app/track-record/page.tsx`](../src/app/track-record/page.tsx).
Receipt: [`src/app/track-record/publication/[publicationId]/page.tsx`](../src/app/track-record/publication/%5BpublicationId%5D/page.tsx).
View model: [`src/lib/performance/trackRecordView.ts`](../src/lib/performance/trackRecordView.ts).
Metrics: [`src/lib/performance/ledgerMetrics.ts`](../src/lib/performance/ledgerMetrics.ts) and
[`trackRecordSummary.ts`](../src/lib/performance/trackRecordSummary.ts).
Exports: [track-record-exports.md](track-record-exports.md).*

## What it is

`/track-record` is the page that answers "how has OddsPadi actually done?".
It reads the publication ledger and nothing else, for a period the visitor
chooses, filtered however they choose, and it exports the same numbers with
their definitions attached.

Everything on it — the summary, the table, the CSV, the JSON and the printable
view — is projected from one `TrackRecordView`. There is no second aggregation
path, so a headline that disagrees with the rows beneath it is not something
the page can express.

## Source of truth

`op_publications`, `op_publication_settlements`, `op_publication_revisions`.
Reads go through [`canonicalReads.ts`](../src/lib/domain/canonicalReads.ts):

| Need | Function |
|---|---|
| One keyset page of the ledger | `readOfficialPublicationPage` |
| Every publication in a period | `readOfficialPublicationsInWindow` |
| First publication, last publication, total | `readLedgerExtent` |
| One claim with its settlements and revisions | `readPublicationReceipt` |

The page may not reconstruct a count from news, `op_market_decisions`,
prediction cards or the projection store. One display join exists and is
labelled as such: team names come from `op_fixtures` for the rows on screen, so
the table can say "Arsenal v Chelsea" instead of `api-football:1`. No number
depends on it, and when it fails the table shows external ids.

**A failed read is never a zero.** Three presentations exist:

- `live` — the ledger answered.
- `last-known-good` — the ledger did not answer, and this runtime has served
  the same query successfully within the last 30 minutes, so the previous
  answer is shown with its age. Per-instance and in memory: a cold instance
  correctly has none.
- `unavailable` — the ledger did not answer and there is nothing to fall back
  on. The page says so. It does not print `0 picks, 0%`.

## Period semantics

Periods are measured by **publication time** — when the claim was made — not by
kickoff. A track record is a record of claims, and a pick published on Sunday
for a Monday fixture belongs to Sunday. Anchoring on kickoff would let a losing
weekend be reported as a fresh week.

Boundaries are resolved in the visitor's timezone, from the cookie
`readTimezonePreference` reads, using `dayWindow`/`dayWindowRange` in
[`src/lib/time/dayWindow.ts`](../src/lib/time/dayWindow.ts). Nothing in the
track record re-derives a day boundary; the helpers already handle DST-short
and DST-long days and already normalise an untrusted cookie value.

| Period | Boundary |
|---|---|
| Today | The visitor's current local day. |
| Yesterday | The local day before it. |
| This week | Monday to today. Still running. |
| Last week | The complete Monday–Sunday before this one. |
| This month | The 1st to today. Still running. |
| Previous month | The complete calendar month before this one. |
| Year to date | 1 January to today. |
| All time | Unbounded. The default. |
| Custom range | Two inclusive local calendar days, up to 1,830 apart. |

A malformed, backwards or over-long custom range falls back to all time and
says why. These values arrive in a URL, which is visitor-controlled input.

### The empty-period problem

At the time of writing the ledger holds **one day** of publishing. Every
relative period except that day is genuinely empty.

The page still offers all of them, because the structure has to be right for a
record that will run for years, and a control that grows new tabs as the
product ages is its own kind of confusing. What it does not do is report a zero
for a period the ledger cannot reach. `describePeriodCoverage` returns one of
five verdicts, and the page prints the sentence:

| Verdict | What it means |
|---|---|
| `unknown` | The extent could not be read. Not a claim that the period is empty. |
| `empty-ledger` | Nothing has ever been published. |
| `entirely-before-ledger` | The period is outside the record — not a period the model went without a result. |
| `partially-covered` | Part of the period predates the ledger. |
| `covered` | The ledger covers the whole period. |

The extent notice at the top of the page states the real span in one sentence,
so a reader is told the record is one day old before they read a hit rate from
it.

## Metrics

Selection metrics and forecast metrics are computed by the same functions the
homepage and the weekly recap use, and are rendered in separate blocks that are
never added together.

- **Selection** (judges a bet at a price): published, settled, pending, won,
  lost, push, void, cancelled, one-unit profit, ROI/yield, hit rate with a 95%
  Wilson interval, average published odds, average closing odds, closing-line
  coverage, average CLV, current streak, current and maximum drawdown, last
  settlement time.
- **Forecast** (judges a probability): Brier score, log loss, expected
  calibration error, Brier skill.

Every one is a `MetricValue` carrying `measured`, `insufficient-sample`,
`not-applicable` or `unavailable`. A renderer prints `formatMetric`, so no tile
can show a bare `0` for something that was never measured.

### Closing odds and CLV

Closing prices are not a ledger column. Where one exists it is on the
publication's `metadata`, written after kickoff by a separate sweep. Most rows
do not have one.

The page therefore reports **coverage** — "0 of 106 publications carry a closing
price" — beside an average CLV of "Not available". Coverage of zero is a
measurement about our data. A CLV of zero would be a claim about the model, and
it is not one we can make.

## Filters

Twelve dimensions, all URL-encoded, all applied by one predicate
(`matchesTrackRecordFilters`) to the summary, the table and both exports:

sport, competition, market family, selection type, model version, calibration
version, decision tier, odds band, probability band, data-readiness band,
publication lead-time band, result state.

Open dimensions (sport, competition, model version, calibration version) are
offered from the values present in the period, so a control never offers an
option that always returns nothing. Closed dimensions are enumerations with
published definitions; an unrecognised value is dropped rather than applied,
because returning zero rows for a typo reads as a result.

Derived bands — odds, probability, lead time, market family, selection type —
are defined once in
[`trackRecordFilters.ts`](../src/lib/performance/trackRecordFilters.ts) and
exported into the page legend, the docs and the export header, so the three
cannot drift.

## The record table

One row per publication, newest first: publication id, published at, kickoff,
fixture, sport, competition, market, selection, published odds, model
probability, fair odds, closing odds, CLV, result, settlement time, unit
return, model version, calibration version and correction state. Every row
links to the canonical match page and to its **publication receipt**.

The receipt at `/track-record/publication/[publicationId]` is the audit trail
for one claim: the claim as struck, the four versions it was struck under, the
evidence cutoff and odds snapshot, every settlement ever recorded against it
(including superseded ones), and every correction with the verbatim prior
state. It is `noindex, follow` — one page per claim exists to be checked from
the record, not to compete in search.

On screens narrower than 860px the table is replaced by the same rows as cards.
Same data, same links, laid out for a thumb.

## Performance

- Reads are **keyset-paginated** over `(published_at, id)`. PostgREST caps a
  response at `db-max-rows` silently, so every page asks for one row more than
  it needs and treats the surplus as "there is another page" rather than
  trusting a count. Offset paging would make page 40 cost forty pages of work.
- The period sweep is bounded: 5,000 rows for a page render, 20,000 for an
  export. A sweep that stops at the cap reports `partial` and the page says so.
  It is never presented as the complete record.
- Every ledger read carries `AbortSignal.timeout(4s)`. Postgres enforces an 8s
  statement timeout on the public role, but a queued request is not covered by
  it, and a public page that hangs is worse than one that says it could not
  read the ledger.
- There is no odds-history scan. Closing prices come from the publication row.

## Evidence classes

Seven classes, rendered as separate blocks with no total anywhere on the page:
official public picks, verified legacy official picks, internal decisions,
editorial archive, shadow decisions, backtests, community selections. Only the
first counts publicly, enforced by a schema check constraint rather than by
filtering discipline.

Verified legacy official picks currently holds **zero rows**: the 2026-07-31
reconciliation found nothing in the product's history that could be shown to
have been published before kickoff. The class exists to say that out loud.

This separation is not presentational. The product previously showed 144 rows
of paper-mode shadow trades as its public record because one sync trigger used
a denylist instead of an allowlist. Every row was real; none was a public pick.

## The seam for advanced analytics

`TrackRecordSummary` carries an optional `advanced?: unknown` field and nothing
else. Deeper statistics — significance against the market, segment-level skill
decomposition, calibration-adjusted expected value — belong to
`src/lib/performance/advancedMetrics.ts` and `docs/performance-metrics.md`,
which this work does not touch.

The contract is:

- Attach a value to `summary.advanced` after `computeTrackRecordSummary`
  returns. Do not change its other fields; the reconciliation test pins them.
- Every renderer treats the field as optional and shows nothing when it is
  absent, so the page is correct with or without it.
- Anything added must obey the two rules the rest of this page obeys: a
  measurement that was not made is null and says why, and a forecast metric is
  never combined with a selection metric into one headline.

## Tests

[`src/test/track-record-structure.test.tsx`](../src/test/track-record-structure.test.tsx)
covers reconciliation (headline equals the sum of rows), filter correctness on
every dimension, URL round-tripping, correction and retraction propagation,
failed reads, last-known-good, zero official sample, small-sample warnings, CLV
missingness, void/push handling, model-version splits, keyset pagination,
CSV/JSON equality and the mobile render.

[`src/test/track-record-integrity.test.ts`](../src/test/track-record-integrity.test.ts)
holds the older contract on `ledgerMetrics` and still applies.
