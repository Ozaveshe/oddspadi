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

## Where it is stored, and why not on the publication

`op_closing_prices`, one current row per publication, never a column on
`op_publications`.

That is not a schema preference. `op_publications` is guarded by
`guard_publication_immutability`, which refuses any change to
`model_probability`, `odds_at_publication`, `implied_probability`, the market,
the selection, the fixture, or the timestamps, unless the write is a proper
revision carrying its prior state. A closing price is **new evidence attached to
a claim after kickoff, not an edit of the claim**, so it does not belong inside
the guarded row and does not need the guard relaxed to get there. The companion
table takes the additive write and the published claim is never touched.

Retries supersede rather than duplicate:
`op_closing_prices_current_idx` allows exactly one current row per publication,
so [`op_supersede_closing_price`](../supabase/migrations/20260808113550_closing_price_retry.sql)
retires the old row and inserts the new one in a single statement, linking them
through `superseded_by_closing_id`. Every attempt survives; only one is current.

## What reads it

[`readClosingPricesFor`](../src/lib/closing/publicationCloses.ts) resolves the
current rows for a page of claims, and `canonicalReads` overlays them onto
`OfficialPublicationDetail.closingOdds`, `closingCaptureStatus` and
`closingMissingReason`. Everything downstream — the track record's coverage and
CLV columns, the CSV export, `clvDistribution` in `advancedMetrics.ts` — reads
that one field.

A companion read rather than a PostgREST embed, matching `readPublicationReceipt`:
foreign-key embeds across these tables have repeatedly returned silently empty
arrays here, and a silently empty embed would reproduce the exact bug this path
was built to close.

Two rules the read layer keeps:

- A claim whose capture came back absent keeps `closingOdds: null` and gains the
  reason. It never inherits a substitute price and never a zero.
- If the closing table cannot be read at all, the page degrades to `partial`
  with a stated reason. An outage must not render as "nobody priced anything",
  which is the same number honest zero coverage would produce.

For claims written before the table existed, a `closingOdds` key in the
publication's `metadata` is still honoured as a fallback. A captured close wins
over it: the capture carries a policy version, a source count and an observation
time, and the metadata number carries no provenance at all.

## Coverage

Derived, not stored: an RPC joining published picks to closing prices, broken
out by sport, day and capture status. A stored coverage table could disagree
with the rows it summarises; a view cannot.

Failures write into `op_settlement_exceptions` under the `close_*` kinds, so
improving coverage is worked from the same queue as settlement exceptions. See
[settlement-exceptions.md](settlement-exceptions.md).

Run the capture by hand with `npm run ops:closing-prices` (dry run) and
`npm run ops:closing-prices -- --commit`.

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

## Capture against published claims, 2026-08-08

The table above measures the market. This one measures the thing the track
record actually reports: the 149 published claims whose kickoff has passed.

| Capture status | Claims | Tennis | Football |
|---|---|---|---|
| `captured` | **0** | 0 | 0 |
| `insufficient_sources` | 128 | 80 | 48 |
| `no_quotes` | 21 | 0 | 21 |

Every eligible claim now carries a capture attempt: `uncaptured_no_row` is 0.

**Closing-line value is therefore not computable today**, and the reason is
depth rather than plumbing. Distinct books quoting the same selection inside the
90-minute window, per claim — taken over the 141 claims eligible when this was
measured, a few minutes before the capture run above:

| Books in window | Claims | After the 45-minute staleness filter |
|---|---|---|
| 3 | 4 | all four drop to 2 |
| 2 | 35 | 20 keep 2, 15 drop to 1 |
| 1 | 82 | 1 |
| 0 | 20 | — |

No claim reaches three fresh books. The maximum anywhere is two. Lowering
`MIN_SOURCE_DEPTH` to 2 would make 24 claims (17%) capturable, and that remains
refused for the reason in the previous section: a two-book median is not a
consensus close, and a wrong close is invisible in a way a missing one is not.

### Four defects found on the way to that number

The 0 above is a real measurement. It was not, before this branch — the pipeline
was producing confident and often false reasons.

1. **Misses were frozen.** The sweep skipped any claim that already had a
   current row, so the `no_quotes` written by the first run after kickoff was
   the reason it never looked again. All 139 claims then eligible carried an
   absent-capture row; 91 had qualifying quotes in the database at the moment
   their miss was written. Absent statuses are now retried and superseded;
   `captured` and `operator_unavailable` are terminal.
2. **The read window was the wrong shape.** A chunk reads
   `[min(kickoff) − 90m, max(kickoff)]`, bounded only by a 25-pick count, so a
   quiet stretch of the calendar stretched one read across days — one chunk
   spanned 74 hours and matched 12,966 rows. Chunks are now bounded by kickoff
   span as well as count.
3. **Tennis could never match.** A tennis claim's `home` resolves to
   `tennis.match_winner.full_match.player_a`, while the odds snapshots store the
   selection as `home`. The claim side went through `legacySelectionKey` and the
   snapshot side through a local string tidy-up, so the two never met and all 80
   eligible tennis claims were recorded as `no_quotes` — false, not merely
   unhelpful, since every one had a fully priced market. Both sides now resolve
   through the same resolver, keyed by sport.
4. **The row cap was the server's, not ours.** PostgREST answers with at most
   `db-max-rows` — 1,000 here — and does not say it truncated. The guard
   compared the returned count against 6,000, so it never fired, and the sweep
   proceeded on the newest 1,000 quotes in the window. Ordered by observation
   time across a whole chunk, those belong to the latest kickoffs: a 21-fixture
   chunk returned 1,000 rows covering 12 fixtures, and 9 claims were handed a
   confident "nobody priced this". Reads are now paged at exactly the server's
   page size, so a short page means there is nothing more.

Before these fixes the ledger said `no_quotes` for 104 of 141 claims. After
them it says `insufficient_sources` for 128 of 149. The coverage number barely
moved; what changed is that the reasons are now true, which is what makes the
depth table above worth acting on.

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
