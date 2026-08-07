# Track record exports

*Formatter: [`src/lib/performance/trackRecordExport.ts`](../src/lib/performance/trackRecordExport.ts).
Routes: [`export.csv`](../src/app/api/track-record/export.csv/route.ts),
[`export.json`](../src/app/api/track-record/export.json/route.ts).
The page they come from: [track-record.md](track-record.md).*

## Why the context travels with the file

An export leaves the page behind. Whoever opens the file next cannot see the
caption that said the sample was 106 picks over one day, cannot see the note
that closing prices are missing for all of them, and has no way to know whether
"ROI" meant return on turnover or return on bankroll.

So every export carries its own context block: the period and its exact UTC
boundaries, the timezone those boundaries were resolved in, every active
filter, the availability of the read, and a definition for every metric and
every derived band in the file. An exported number with no definition is a
number someone will misquote, and the misquote will be attributed to us.

## Formats

| Format | URL | Content type |
|---|---|---|
| CSV | `/api/track-record/export.csv` | `text/csv; charset=utf-8` |
| JSON | `/api/track-record/export.json` | `application/json; charset=utf-8` |
| Printable | `/track-record?view=print` | The page itself, controls removed |

All three take the same query string as `/track-record`, so the file matches
the view on screen rather than the unfiltered record. The export links on the
page are built from the active view, so this happens without the reader having
to think about it.

The printable variant is a variant of the page, not a separate document. A
second print renderer would be a second implementation of the record, and a
second implementation eventually prints a different number from the one on
screen. It lays out at most 500 rows and says so when the view has more.

## Filter context

Both machine formats carry the same keys:

| Key | Meaning |
|---|---|
| `period` | The period label — "Last week", "Custom range", … |
| `periodDefinition` | One sentence naming the exact boundary. |
| `timeZone` | The zone those boundaries were resolved in. |
| `periodStart` / `periodEnd` | The UTC instants, or "none (all time)". |
| `periodCoverage` | How much of the period the ledger actually reaches. |
| `dataAvailability` | `complete`, `partial`, `confirmed_empty` or `unavailable`. |
| `presentation` | `live`, `last-known-good` or `unavailable`. |
| One key per active filter | Its human label and value. |
| `filters` | `none`, when no filter is applied. |

Warnings are separate from context and appear in both formats when they apply:
an unreadable ledger, a last-known-good answer with its age, a sweep that hit
its row cap, and the small-sample warning.

## CSV shape

The context, the summary, the definitions and the notes travel as `#`-prefixed
comment lines ahead of the data. pandas (`comment="#"`), R
(`comment.char="#"`) and most spreadsheet importers either skip them or park
them in a single column. Below them is plain RFC 4180 with one header row, CRLF
line endings, so nothing has to be cleaned before it can be parsed.

```
# OddsPadi official public track record
# Generated at 2026-08-07T10:00:00.000Z (UTC)
#
# -- Filter context --
# period: All time
# ...
# -- Summary --
# Won: 44
# ...
# -- Metric definitions --
# Hit rate: Won divided by decided. Pushes, voids, ...
# ...
# -- Band definitions --
# Odds band / 2.00–2.99: Odds at publication from 2.00 up to but not including 3.00.
# ...
# -- Notes --
# An empty cell means the value is not known. It never means zero.
#
publication_id,published_at_utc,kickoff_at_utc,fixture,...
```

Fields containing a comma, a quote or a newline are quoted and internal quotes
are doubled.

### Columns

`publication_id`, `published_at_utc`, `kickoff_at_utc`, `fixture`,
`fixture_external_id`, `sport`, `competition`, `market`, `market_family`,
`market_line`, `selection`, `selection_label`, `selection_type`,
`odds_at_publication`, `odds_band`, `model_probability`, `fair_odds`,
`probability_band`, `closing_odds`, `closing_line_value`, `result`,
`settled_at_utc`, `unit_return`, `model_version`, `calibration_version`,
`decision_tier`, `data_readiness`, `lead_time_hours`, `lead_time_band`,
`correction_state`, `correction_reason`, `revision`.

Timestamps are ISO-8601 UTC. Rendering them in the visitor's timezone would
make two exports of the same rows differ, which is the opposite of what an
export is for; the timezone the *period* was resolved in is in the context
block.

## JSON shape

```jsonc
{
  "generatedAt": "2026-08-07T10:00:00.000Z",
  "source": {
    "tables": ["op_publications", "op_publication_settlements", "op_publication_revisions"],
    "recordClass": "official_public_pick",
    "availability": "complete",
    "presentation": "live",
    "lastKnownGoodAt": null,
    "truncated": false
  },
  "context": { /* the table above */ },
  "coverage": "The ledger covers this period in full (2026-08-03 to 2026-08-03).",
  "ledgerSpan": { "firstPublishedAt": "...", "lastPublishedAt": "...", "totalPublished": 230, "spanDays": 1, "availability": "measured" },
  "warnings": ["These figures come from 106 settled picks. ..."],
  "summary": { "Hit rate": "41.5%", "Average CLV": "not available (unavailable)" },
  "summaryValues": { "hitRate": 0.415, "averageClosingLineValue": null },
  "definitions": [{ "metric": "Hit rate", "definition": "..." }],
  "bandDefinitions": [{ "dimension": "Odds band", "band": "2.00–2.99", "definition": "..." }],
  "notes": ["An empty cell means the value is not known. It never means zero."],
  "rowCount": 230,
  "rows": [ /* one object per publication */ ]
}
```

`summary` is the human-readable rendering, including the reason a value is
absent. `summaryValues` is the machine-readable pair, where an absent value is
`null`.

## The null rule

**An empty CSV cell, and a JSON `null`, mean "not known". Neither means zero.**

This is the rule the whole record is built on, and it is the first one lost when
somebody serialises a null as `0` to keep a spreadsheet tidy. A hit rate of
`null` means nothing has settled; a hit rate of `0` would mean everything
settled and everything lost. A CLV of `null` means we hold no closing price; a
CLV of `0` would mean the published price exactly matched the close.

A contract test compares the two formats row for row and value for value, so
they cannot drift into disagreeing about which numbers exist.

## Caching

Both routes are public, CDN-cacheable for 300 seconds, and declare every query
key they read to `publicCacheInit` so Netlify emits
`Netlify-Vary: query=period|from|to|rows|after|sport|…`. An undeclared key is
not merely uncached — it is served from another visitor's cache entry, so a
request for the football record could be answered with the tennis one. Only
known keys are read out of the URL at all; an arbitrary query string cannot put
arbitrary text into a downloaded file.

## What is never in an export

- Any record class other than `official_public_pick`. Shadow decisions,
  backtests, editorial observations and community selections are separate
  classes on the page and are absent from these files entirely.
- Operator detail: run identifiers, provider names, job names, environment
  variable names or raw database errors. A failed read is reported as a warning
  sentence, not as a stack trace.
