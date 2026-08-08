# Platform imports and conversion

How selections cross between the Bet Workspace and other platforms — in both
directions, and only as far as the evidence reaches.

## Importing a slip

Imports go through registered adapters (`workspace/bookmakerAdapters.ts`).
An adapter declares exactly what it understands — format, sports, markets,
odds notation — and parsing is all-or-nothing: one unparseable line rejects
the whole slip with the line and reason named. A half-understood import
would produce confidently wrong analysis, which is worse than none.

One adapter is registered today: `oddspadi-text`, the product's own exported
slip format (pipe-delimited, football, three markets, decimal odds). Real
bookmaker formats are added one at a time, each with its own scraped label
evidence and its own tests. `listSupportedImports()` is the honest catalogue
— **the product never claims universal bookmaker support**, in either
direction.

Imported legs resolve through the same gate as every other leg. A line that
parses but names a market outside the canonical bridge becomes a leg with no
canonical key: carried, priced, excluded from canonical settlement and
conversion, with the exclusion stated.

## Converting a leg outward

The workspace shows what a leg is called on a registered platform via the
Market Mapping service (`markets/conversion.ts`, wrapped for legs by
`workspace/platformView.ts`, served by `/api/workspace/convert` with the
live alias store).

The five honest answers, all surfaced:

| Status | Meaning |
|---|---|
| `exact` | Label and settlement rules both match |
| `conditional` | Equivalent only under stated conditions, shown with them |
| `settlement_warning` | The label matches; the settlement may not. The warning is passed through verbatim |
| `unsupported` | The platform does not carry this market |
| `unavailable` | The platform likely carries it, but no verified label/mapping is on record |

The one guarantee: `different_settlement` can never present as `exact`. Draw
No Bet and Asian Handicap 0 read identically on a slip and behave
differently in a multiple; a tennis market that voids on retirement is not
the market that settles on the award. That invariant lives in the conversion
service and is pinned by tests there — the workspace only inherits it.

## Settlement warnings are the product

A user acting on a conversion acts financially on the settlement claim, not
the label. Every conversion summary sentence therefore keeps the warning
inline; no summarisation step may drop it.
