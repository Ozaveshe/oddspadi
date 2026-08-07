# Result verification, settlement and closing-price capture

Design, 2026-08-07. Approved for implementation in six phases.

## Why

A track record is only as good as the results behind it. Today OddsPadi settles
from a single aggregate score and captures no closing price worth the name, so
three failures are currently possible and two of them are silent:

1. **Wrong basis.** `op_fixtures` stores only `home_score` / `away_score`. A
   cup tie decided on penalties therefore settles 1X2 against a post-shootout
   score, which is not what a 1X2 market resolves on. Nothing detects this.
2. **Unsettleable markets.** Decisions already exist for `spread`,
   `set_handicap` and `total_games`. The flat grader in
   [`marketDecisionSettlement.ts`](../../../src/lib/sports/results/marketDecisionSettlement.ts)
   cannot resolve any of them, so every one returns `needs_review` forever.
3. **No closing line.** `op_mark_closing_odds()` flips an `is_closing` boolean
   on one snapshot per bookmaker. There is no record of *why* a close is
   absent, no source depth, and no way to tell a missing close from a captured
   one at read time — which is exactly the shape that turns into a zero.

The goal is a pipeline where a finished event produces a verified canonical
result, that result settles official picks through versioned sport-specific
rules, and a closing price is captured under a stated policy or recorded as
absent with a reason.

## Scope

In: canonical result store, verification, versioned rule registry, settlement
engine, exception queue, closing capture, coverage, CLV, operator API, alerts,
fixture suite, five documents.

Out: a web operator console (API + CLI only), a second commercial result
provider (the interface ships, one implementation is registered), push delivery
of alerts.

## Decisions taken

| Decision | Choice | Why not the alternative |
|---|---|---|
| Result storage | New `op_fixture_results` | `op_fixtures` is upserted every refresh; verification state and corrections cannot survive an upsert |
| Rule location | Versioned TypeScript registry | A 16-case Asian-handicap table in PL/pgSQL is untestable without a database, and every revision would be a migration |
| Secondary source | Pluggable interface, one implementation | No provider quota spent on an API already returning 429s; a real secondary drops in without schema change |
| Operator surface | Token-guarded admin API + CLI | No authenticated UI surface exists in this app; adding one is its own security scope |
| Alerts | Derived at read time | A persisted alert ledger can disagree with the exceptions it describes |
| Closing price | Consensus close, minimum depth | A single book's late quote is noise; the Shin de-vig for consensus already exists |
| History | Backfill + audited re-settle | A ledger mixing two settlement bases makes `rule_version` on old rows a fiction |

## 1. Canonical result

`op_fixture_results` — one *current* row per fixture, append-only revisions.
`op_fixtures` is untouched and remains the ingest surface.

| Group | Columns |
|---|---|
| Identity | `id`, `fixture_id`, `sport`, `revision`, `is_current`, `superseded_by_result_id`, `correction_reason` |
| Outcome class | `result_status` ∈ `finished`, `postponed`, `cancelled`, `abandoned`, `retired`, `walkover`, `awarded` |
| Football | `regulation_home/away`, `extra_time_home/away`, `shootout_home/away` |
| Tennis | `sets_home/away`, `games_home/away` |
| All sports | `period_scores jsonb` — quarters and OT for basketball, per-set games for tennis |
| Verdict | `winner` ∈ `home`, `away`, `draw`, `none`; `winner_basis` ∈ `regulation`, `extra_time`, `shootout`, `retirement`, `walkover`, `awarded` |
| Provenance | `primary_provider`, `primary_receipt_id`, `secondary_provider`, `secondary_receipt_id`, `observation_count`, `first_observed_at`, `last_observed_at`, `final_at` |
| Verification | `verification_state`, `verified_at`, `verified_by` |

`result_status` is our classification of the event, not the provider's raw
status string. The two are allowed to disagree, and when they do the
disagreement is the finding.

### Score basis is declared, not assumed

Stated in the column comments so nobody re-derives it wrong from the data:

- `regulation_*` — the score at the end of normal time.
- `extra_time_*` — the score at the end of extra time, **inclusive of
  regulation**, matching API-Football's `score.extratime`.
- `shootout_*` — penalties alone, exclusive of everything before them.

Football 1X2 reads `regulation_*`. Nothing else does.

### The verification ladder

| State | Meaning | Settleable |
|---|---|---|
| `provisional` | Provider reports terminal; conditions below not met | **No** |
| `verified` | Terminal status, score complete for this sport's markets, and either two agreeing primary observations ≥10 minutes apart or an agreeing secondary source | Yes |
| `conflicted` | Observations disagree | No — raises `result_conflict` |
| `manual_review` | Needs a human: ambiguous retirement, unmatched participant | No — until an operator verifies |

`verified_by` is the literal `automatic` for the ladder above, or the operator
identifier when a human verified it through the admin API.

"Do not settle on a provisional score" is enforced by the settlement query
reading only `verification_state = 'verified'`, not by discipline. Where
`op_live_match_events` holds rows for the fixture, the event stream is
cross-checked against the final score as a third signal.

**Provisional does not last forever.** A fixture that has held one stable,
uncontradicted observation for 6 hours will never accumulate a second one — the
provider has said its last word. It escalates to `manual_review` and raises a
`result_conflict` exception with `detail.reason = 'single_observation_timeout'`,
so an operator resolves it rather than the SLA alert firing on the same row
indefinitely. This is the difference between an alert that means something and
an alert everyone learns to ignore.

The secondary source is an interface:

```ts
type ResultSource = {
  id: string;
  observe(fixture: FixtureRef): Promise<ResultObservation | null>;
};
```

One implementation is registered today: re-observation of the primary provider
at a later time. Adding The Odds API `/scores` later is a new implementation and
no schema change.

### Corrections cascade, they never overwrite

A provider revising a score writes revision N+1, retires N through
`superseded_by_result_id`, and enqueues a re-settle. The re-settle supersedes
the verdict through the existing `op_settle_publication()` path.

Publication evidence is structurally safe rather than protected by convention:
settlement writes only to `op_publication_settlements`, and no code path in this
design writes to `op_publications`.

A partial unique index enforces one current result per fixture, mirroring
`op_publication_settlements_current_idx`.

## 2. Settlement rules

Each rule is a record, not a branch:

```ts
type MarketRule = {
  id: "football.asian_handicap";   // canonical id, never a provider name
  sport: "football" | "basketball" | "tennis";
  version: "2026-08-07.1";         // stamped on every settlement it produces
  basis: SettlementBasis;          // declared; a rule without one does not compile
  requiresLine: boolean;
  grade(result: CanonicalResult, claim: Claim): Grade;
};
```

`SettlementBasis` is a closed union: `regulation`, `including_extra_time`,
`including_shootout`, `full_game_including_ot`, `regulation_excluding_ot`,
`sets`, `games`, `match_award`.

Provider naming never selects a rule. `resolveMarket(providerName, sport)` maps
into canonical ids; anything unmapped raises `unknown_market` and settles
nothing.

### Coverage

| Sport | Market | Basis | Notes |
|---|---|---|---|
| Football | 1X2, double chance, BTTS, over/under | `regulation` | |
| | draw no bet | `regulation` | draw returns `push` |
| | Asian handicap | `regulation` | quarter lines split half-win / half-loss |
| | to-qualify, outright | `including_shootout` | |
| | postponed, abandoned | — | `void`; `awarded` settles on the award |
| Basketball | moneyline, spread, total | `full_game_including_ot` | exact line returns `push` |
| | moneyline_regulation | `regulation_excluding_ot` | separate rule id, not a flag |
| | shortened game | — | `void` below the league's completion threshold; parameter, default all four quarters |
| Tennis | match winner | `match_award` | retirement settles on the awarded winner; walkover `void` |
| | set handicap, total games, set betting | `sets` / `games` | retirement `void` — the count never finalised |
| | incomplete, no award | — | `needs_review` |

Basketball's include-or-exclude-overtime distinction is two rule ids rather than
one parameterised rule. A mapping mistake is then a *missing rule*, which is
loud, instead of a *wrong basis*, which is silent.

Tennis `match_winner` settling a retirement on the awarded winner is the
bookmaker-majority convention and is a deliberate choice; it is written into
`docs/market-settlement-rules.md` as OddsPadi's stated rule rather than left to
a provider's default.

### Enum extension

Asian quarter lines produce half-win and half-loss, which the current
`settlement_status` check constraint cannot express. It gains `half_won` and
`half_lost`, and settlements carry an explicit `return_multiple`
(`+(odds−1)/2` and `−0.5`).

This changes accounting and must be applied consistently: a half-win is a
played pick and enters the accuracy denominator; a push still does not.
Consumers to update: `canonicalReads.ts`, `ledgerMetrics.ts`,
`advancedMetrics.ts`, the public results surfaces, and
`docs/settlement-rules.md`.

### Engine

```ts
settle(result: CanonicalResult, claim: Claim, registry: RuleRegistry): Settlement
```

Pure — no I/O, no clock. The same result revision, claim and rule version
always produce the same verdict, so replay is free and the fixture suite needs
no database.

Idempotency and supersession stay where they already work: `op_settle_publication()`
and the one-current partial index. A duplicated settlement job cannot
double-settle because the second write is a no-op against an identical verdict.

The same registry grades `op_market_decisions`, so the training corpus and the
public ledger cannot drift onto two different truths.

## 3. Exception queue

`op_settlement_exceptions`:

`fixture_id`, `publication_id`, `market`, `selection`, `kind`, `severity`,
`detail jsonb`, `state` ∈ `open`/`acknowledged`/`resolved`/`dismissed`,
`resolution`, `resolved_by`, `resolved_at`, `first_seen_at`, `last_seen_at`.

`severity` ∈ `critical` (a published claim is wrong or unsettleable — every
result conflict, duplicate result and provider correction), `warning` (a claim
is degraded but honest — missing close, insufficient sources), `info` (worth
knowing, no claim affected — an unknown market on an unpublished decision).

Settlement kinds: `result_conflict`, `unknown_market`, `missing_line`,
`ambiguous_retirement`, `abandoned_fixture`, `duplicate_result`,
`missing_participant_identity`, `provider_correction`.

Closing kinds: `close_missing`, `close_insufficient_sources`,
`close_identity_failure`, `close_market_unmapped`, `close_late_data`.

One queue, not two. A partial unique index on the open row per
(kind, fixture, publication, market, selection) means an hourly sweep touching
the same unresolved problem updates `last_seen_at` on one row rather than
growing a pile.

## 4. Closing price

Policy `close.v1`, documented in `docs/closing-price-policy.md`. The version
string is stamped on every captured row, so a policy change is visible in the
data and not only in git history.

1. Eligible quotes: `op_odds_snapshots` with `is_live = false`, matching the
   claim's canonical market, selection and line, `observed_at` within
   `[kickoff − 90min, kickoff]`.
2. One quote per bookmaker — the latest in window.
3. **Maximum age:** a book's latest quote older than 45 minutes before kickoff
   is dropped as stale, even though it lies inside the window.
4. **Minimum depth:** three distinct books after step 3. Below that the status
   is `insufficient_sources` and **no odds are stored**.
5. `closing_odds` is the median decimal price across qualifying books.
   `closing_probability` is the Shin no-vig consensus over the full market,
   reusing [`oddsConsensus.ts`](../../../src/lib/sports/oddsConsensus.ts).
6. Capture runs only after kickoff, when the window is closed.

`op_closing_prices` — one current row per publication, superseded on retry:
`publication_id`, `fixture_id`, `market`, `selection`, `market_line`,
`closing_odds`, `closing_probability`, `published_probability_novig`, `source`,
`source_count`, `source_bookmakers[]`, `close_observed_at`, `kickoff_at`,
`captured_at`, `capture_status`, `missing_reason`, `policy_version`,
`revision`, `is_current`, `superseded_by_closing_id`.

`capture_status` ∈ `captured`, `insufficient_sources`, `no_quotes`, `stale`,
`market_unmapped`, `identity_failure`, `late_provider_data`,
`operator_unavailable`.

### The prohibitions are structural

- `check ((capture_status = 'captured') = (closing_odds is not null))` — a
  missing close cannot become a number.
- `check (close_observed_at is null or close_observed_at <= kickoff_at)` — a
  post-start price is rejected by the database, not merely by the query.
- There is no opening-odds fallback branch to disable, because the window
  filter is the only path from a claim to a quote.
- `missing_reason` is required whenever `capture_status <> 'captured'`.

`operator_unavailable` is the operator's "mark unavailable with reason". It is
recorded as a status with a reason, never as a zero.

## 5. Coverage

Derived, not stored: an RPC joining published picks to closing prices, broken
out by sport, day and capture status — eligible, captured, missing, and the
reason mix. A stored coverage table could disagree with the rows it summarises;
a view cannot.

Tracked reasons map one-to-one onto the requirement list: source insufficiency
(`insufficient_sources`), identity failure (`identity_failure`), market mapping
failure (`market_unmapped`), late provider data (`late_provider_data`).

Coverage failures write into `op_settlement_exceptions` under the closing kinds,
so improving coverage is worked from the same queue as settlement exceptions.

## 6. CLV

Method `clv.v1`, documented in `docs/clv-methodology.md`.

- **Odds-based:** `published_odds / closing_odds − 1`. Already implemented at
  [`advancedMetrics.ts:968`](../../../src/lib/performance/advancedMetrics.ts) —
  reused, not reimplemented.
- **Probability-based:** `p_close_novig − p_published_novig`. Both de-vigged
  through Shin. `published_probability_novig` is stored on the closing row so
  the figure is reproducible without re-deriving the publication-time market.

`published_probability_novig` describes the *publication*, not the close, so it
is computed and stored on every capture attempt including the failed ones. A row
with `capture_status = 'no_quotes'` still records what we published at; only
`closing_odds` and `closing_probability` are null.

Both carry the same sign convention — positive means the price beat the close.
They disagree in magnitude on longshots, which is worth keeping visible: that is
where this book has previously been misled.

**A missing close is never zero.** Every aggregate returns `covered`,
`uncovered` and `mean_over_covered` as one non-optional triple, so a caller
cannot render a mean without also holding the denominator it was taken over.
This extends the existing `clvDistribution` contract to the probability series.

## 7. Operator workflow

Token-guarded with the existing `ODDSPADI_ADMIN_TOKEN` check in
[`intelligence/auth.ts`](../../../src/lib/sports/intelligence/auth.ts), under
`/api/admin/settlement/`:

| Route | Action |
|---|---|
| `GET exceptions` | the queue, filtered by kind, state, sport |
| `GET results/:fixtureId` | every observation, provider receipt, revision and the verification state |
| `POST results/:fixtureId/verify` | operator verification; `evidence` note required |
| `POST results/:fixtureId/correct` | new result revision with reason; cascades a re-settle |
| `POST settle/:publicationId` | settle by choosing a rule id from the registry |
| `POST close/:publicationId/unavailable` | required reason → `operator_unavailable` |
| `POST close/:publicationId/retry` | re-run capture |
| `POST identity/:fixtureId` | correct participant identity |
| `POST exceptions/:id` | acknowledge, resolve or dismiss with a note |

An operator chooses **a rule**, never **a verdict**. No endpoint accepts an
outcome string, so "settle this as won" is not expressible in the API.

No admin route writes to `op_publications`. `odds_at_publication`,
`model_probability` and `published_at` are unreachable from the operator
surface, and a test asserts it rather than a comment claiming it.

Every action appends to `op_settlement_operator_actions` (`actor`, `action`,
`target`, `payload`, `evidence`, `created_at`).

CLI wrappers: `ops:settlement-exceptions`, `ops:closing-coverage`, `ops:alerts`,
`ops:settle-results` (dry run by default).

## 8. Alerts

Derived at read time, exposed at `GET /api/admin/settlement/alerts` and through
`ops:alerts`, which follows the `reconcile-truth` contract: exit 0 clean, 1
critical findings, 2 could not complete. An unreadable source is a finding of
its own and forces exit 2 — it never reports zero on failure.

| Alert | Condition | Severity |
|---|---|---|
| `result-unverified-sla` | terminal ≥3h, not verified | critical |
| `pick-unsettled-sla` | result verified ≥1h, pick still unsettled | critical |
| `close-missing-near-cutoff` | kickoff under 30min, eligible pick, depth below minimum | warning |
| `result-conflict` | any open conflict exception | critical |
| `settlement-correction` | a verdict superseded in the last 24h | warning |
| `mass-void` | void share above 15% of ≥10 settlements in 24h | critical |
| `provider-result-lag` | median final→first-observation above 90min over 24h | warning |

## 9. Tests

`src/test/settlement-fixture-suite.test.ts` — table-driven, no database:

football regulation draw; extra-time winner; penalty shootout; Asian handicap
half win and half loss on quarter lines in both directions; total push;
basketball overtime; basketball push; tennis retirement (match winner settles,
set markets void); tennis walkover; postponed; abandoned; provider correction;
duplicate settlement; missing close; stale close; late price after start;
insufficient sources.

The case worth naming: the same overtime basketball game graded by `moneyline`
and by `moneyline_regulation` must produce *different* verdicts. If they ever
agree, the basis wiring is broken and every other test still passes.

Supporting suites: the verification ladder; the closing policy window, depth and
staleness rules; CLV with missing closes excluded rather than zeroed; the admin
routes proven unable to write publication columns; exception deduplication
across repeat sweeps.

## 10. Documentation

New: `docs/result-verification.md`, `docs/market-settlement-rules.md`,
`docs/closing-price-policy.md`, `docs/clv-methodology.md`,
`docs/settlement-exceptions.md`.

Updated: `docs/settlement-rules.md` (currently describes the flat grader; points
at the versioned registry), `docs/reconciliation-monitoring.md` (the new
alerts).

## Phases

The order is forced by the dependency chain.

1. Canonical result store; provider parsing for extra time, penalties, sets and
   periods; verification ladder; backfill **dry-run report**.
2. Rule registry, pure engine, `half_won`/`half_lost` enum extension and its
   consumers, exception queue. Publications and market decisions both move onto
   the registry.
3. Audited re-settle of history: dry-run diff reviewed and approved before any
   write. This is the only phase that changes public record.
4. Closing capture, coverage RPC, probability CLV series.
5. Admin API, CLI wrappers, alerts.
6. The five documents.

## Acceptance

- Official picks settle only from `verification_state = 'verified'` canonical
  results.
- Every settlement carries a `rule_id`, `rule_version` and declared `basis`.
- A repeated settlement run writes nothing new and leaves exactly one current
  verdict per publication.
- Every correction is an append, readable alongside what it replaced.
- Every closing price carries `policy_version` and `source_count`.
- No row exists with `capture_status <> 'captured'` and a non-null
  `closing_odds`; no CLV aggregate reports a mean without its uncovered count.
- Settlement and closing exceptions are visible in one queue through the API
  and the CLI, and breach SLAs raise alerts.
