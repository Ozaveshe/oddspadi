# Closing price policy

*Implementation: [`policy.ts`](../src/lib/closing/policy.ts). Storage:
`op_closing_prices`. Version: `close.v1`, stamped on every row.*

## What was there before

A boolean. `op_mark_closing_odds()` flips `is_closing` on the last pre-kickoff
quote per bookmaker. That records which row was last. It does not record how
many books were behind it, how stale the quote was, or — the part that matters —
why a close is absent when it is.

The failure being designed out is the one where a missing close becomes a zero
downstream, and a CLV average quietly includes fixtures nobody ever priced.

## `close.v1`

1. **Eligible quotes.** `op_odds_snapshots` with `is_live = false`, matching the
   claim's canonical market, selection and line, `observed_at` inside
   `[kickoff − 90min, kickoff]`.
2. **One quote per book** — the latest inside the window.
3. **Maximum lag.** A book's latest quote is dropped when it lags the newest
   qualifying quote by more than 45 minutes. Measured against the close, not
   against kickoff: a consensus close is books priced at roughly the same
   moment, and a book quoting 40 minutes out is only stale if the others quoted
   at five.

   The first version measured this from kickoff, which made the 90-minute
   window unreachable — 45 is stricter than 90, so the window never bound and
   the documented rule could not fire. Two constraints where one silently
   dominated.
4. **Minimum depth.** Three distinct books after step 3. Below that the status
   is `insufficient_sources` and **no odds are stored**.
5. **Closing odds** are the median decimal price across qualifying books.
   **Closing probability** is the median of the per-book Shin de-vigged
   probabilities.
6. Capture runs only after kickoff, when the window is closed.

Shin per book, and the median taken *after* de-vigging rather than before:
proportional de-vig charges the margin evenly and so overstates every longshot,
and a median of raw implied probabilities cannot wash that out because every
book carries the same bias. [`oddsConsensus.ts`](../src/lib/sports/oddsConsensus.ts)
reached the same conclusion for live pricing.

## Capture status

| Status | Meaning |
|---|---|
| `captured` | Policy satisfied; odds and probability stored |
| `insufficient_sources` | Fewer than three books after staleness filtering |
| `no_quotes` | Nothing observed inside the window |
| `stale` | Quotes existed in the window but all were older than 45 minutes |
| `market_unmapped` | No canonical alias maps the market, so no quote matches the claim |
| `identity_failure` | Fixture or participant identity could not be resolved |
| `late_provider_data` | Every quote arrived after kickoff and was refused |
| `operator_unavailable` | An analyst recorded, with a reason, that no close existed |

Every non-captured status carries a `missing_reason`, required by check
constraint.

## The prohibitions are structural

- `check ((capture_status = 'captured') = (closing_odds is not null))` — a
  missing close cannot become a number.
- `check (close_observed_at is null or close_observed_at <= kickoff_at)` — a
  post-start price is refused by the database, not merely by the query.
- **There is no opening-odds fallback branch to disable**, because the window
  filter is the only path from a claim to a quote. A quote from three hours out
  is exactly the number a fallback would grab, and it produces `no_quotes`.

Refused quotes are counted rather than dropped, so coverage can tell "the
provider was late" (`rejected.lateAfterStart`) apart from "nobody priced it"
(`rejected.outsideWindow`) apart from "the prices were old"
(`rejected.stale`).

## Coverage

Derived, not stored: an RPC joining published picks to closing prices, broken
out by sport, day and capture status. A stored coverage table could disagree
with the rows it summarises; a view cannot.

Failures write into `op_settlement_exceptions` under the `close_*` kinds, so
improving coverage is worked from the same queue as settlement exceptions. See
[settlement-exceptions.md](settlement-exceptions.md).

## The measured reality, 2026-08-08

Depth per (fixture, market, selection), by how far before kickoff the quote was
observed. Production, all sports:

| Window before kickoff | 1 book | 2 books | ≥3 books |
|---|---|---|---|
| Last 90 min | 84.7% | 13.7% | **1.6%** |
| 90 min – 6 h | 43.2% | 25.1% | **31.6%** |
| 6 h – 24 h | 27.7% | 20.5% | **51.8%** |

Fifteen bookmakers quote OddsPadi's fixtures, Pinnacle among them. The market
is there. **It stops being captured near kickoff.**

So the low number is a fact about the odds sweep's cadence, not about the
market and not about the threshold. Three conclusions follow, and the second is
the one worth defending:

1. `MIN_SOURCE_DEPTH` stays at 3. Lowering it to 2 reaches 15.2% — a weaker
   number bought for almost nothing.
2. **The window is not widened to make coverage look better.** A price from six
   hours out is not a closing price. Relabelling one corrupts every CLV figure
   that reads it, and unlike a missing close, a wrong close is invisible.
3. The fix is collection, not definition: see
   [`closingWindowRefresh.ts`](../src/lib/closing/closingWindowRefresh.ts) and
   the `refresh-closing-odds` cron, which poll only fixtures inside their
   closing window carrying a published claim.

Until that sweep runs on a schedule, expect most closes to record
`insufficient_sources`. That is the honest reading of the data, and the
coverage queue exists to make it visible rather than to hide it.

Re-measure with:

```sql
select depth, count(*) from (
  select count(distinct o.bookmaker) as depth
  from public.op_odds_snapshots o
  join public.op_fixtures f on f.id = o.fixture_id
  where o.is_live = false
    and o.observed_at <= f.kickoff_at
    and o.observed_at >= f.kickoff_at - interval '90 minutes'
  group by o.fixture_id, o.market, o.selection
) t group by depth order by depth;
```
