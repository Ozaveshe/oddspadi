# Community tip ledger

The accountable half of community: a **trackable community selection** is an
immutable, settled record — separate from official OddsPadi performance in
every direction.

## The tracked record

Every tip row (`op_community_tips`) carries:

| Field | Column |
|---|---|
| user | `author_id` |
| fixture | `fixture_db_id` (FK to `op_fixtures`) + `fixture_id` (canonical external id) |
| market | `market` |
| selection | `selection` + `selection_label` |
| line | `market_line` (quarter steps, nullable) |
| odds | `tipped_odds` |
| odds source | `odds_source` (bookmaker via the match odds board, or `user-entered`) |
| timestamp | `published_at` / `created_at` |
| scheduled start | `kickoff_at` (overwritten from the stored fixture, never trusted from the client) |
| canonical market version | `canonical_selection_key` + `market_version` |

The canonical identity is resolved server-side at publish time through the
same bridge the Bet Workspace uses (`legacySelectionKey` →
`canonicalSelection`, registry `src/lib/markets/canonicalMarkets.ts`). An
unmappable market stays `null` — recorded honestly, never guessed.

## Pre-start only

Community tips lock **30 minutes before kickoff**, enforced three times:
`parseCommunityTipDraft` (contract), the RLS insert policy
(`kickoff_at > clock_timestamp() + interval '30 minutes'`), and the
`op_canonicalize_community_tip_fixture` trigger (which also re-reads the
stored fixture's status and kickoff). Post-start submission is structurally
impossible, which is why the leaderboard needs no post-start gate.

## Immutability and the edit boundary

- Tracked values are immutable **for every role including the service role**:
  the `op_guard_community_tip_update` trigger raises on any change to author,
  fixture, market, selection, line, odds, source, stake, canonical identity or
  timestamps (migration `20260808181000_community_tip_ledger_v2.sql`).
- Authenticated grants allow UPDATE on exactly `(rationale, deleted_at)`.
  A user may edit **commentary** (`PATCH /api/community/tips`; stamps
  `rationale_updated_at`) but never the tracked market, odds or timestamps.
- Corrections and withdrawals stay append-only rows in
  `op_community_tip_revisions` (withdrawal only before the lock, once, and
  never after settlement).

## Ledger states

`communityTipStatus` (`src/lib/community/tipStatus.ts`) derives one of
`pending | won | lost | push | void | corrected | moderated`:

- `pending` — no settlement row yet.
- `won/lost/push/void` — from `op_community_tip_settlements.result`
  (service-role-only writes).
- `corrected` — unsettled tip with an appended correction note (a settled
  result outranks the note).
- `moderated` — `moderated_at` set by a moderator; shadows display, never the
  settled economics.

## Deletion: tombstones, not erasure

`DELETE /api/community/tips?tipId=` sets `deleted_at` (one-way; the freeze
trigger refuses restoration). A deleted tip:

- leaves normal display (fixture desk and tip feeds filter it),
- appears on the author's profile as a tombstone ("Deleted by the tipster —
  the settled result stays in the record"),
- **keeps settling and keeps counting**: the settlement sweep deliberately
  does not filter `deleted_at`, and the performance view counts deleted tips'
  results. A validly posted loss cannot be deleted out of the statistics.
- counts against leaderboard eligibility when excessive (>25% of tracked
  tips).

## Settlement

`runCommunityTipSettlement` (`src/lib/community/tipSettlement.ts`), called by
the settle-results cron: provider-backed stored fixtures only (never manual/
mock/demo/seed evidence), void on cancellation, 24-hour windows for postponed/
suspended/missing evidence, tennis limited to match-winner. Grading uses
`buildDecisionOutcomeSettlement` with the **stored `market_line`** (label
regex only as legacy fallback). Economics: won → `stake × (odds − 1)`, lost →
`−stake`, push/void → 0. Results are upserted once per tip
(`op_community_tip_settlements`, PK `tip_id`) and never overwritten.

Known divergence, on purpose for now: official publications and workspace legs
grade through `settle()` (`src/lib/settlement/grade.ts`) against verified
canonical results; community tips grade against stored provider fixtures. Every
tip now records its canonical selection key and market version, so unifying the
graders is a clean follow-up rather than a data migration.

## Leaderboard

`op_public_tipster_leaderboard` (migration
`20260808182000_community_moderation.sql`). Eligibility gates:

- ≥ 5 settled non-void tips (sample floor),
- account older than 7 days,
- `account_type` in (`organic`, `staff`) — demo/system accounts never rank,
- no integrity flag,
- deleted tracked selections ≤ 25% of tracked tips.

Ranking is **evidence-adjusted yield** (net units over staked units + a
20-unit prior), never raw hit rate, so a lucky tiny sample cannot dominate.
The UI (`TipsterLeaderboard`) shows sample, W–L–P record, average settled
odds, yield, a 95% Wilson interval on the decided hit rate
(`wilsonInterval`, `src/lib/performance/ledgerMetrics.ts`), and the
sport/market mix. When nobody qualifies the top seat stays visibly open.

## Separation from official records

Community settlement writes only `op_community_tip_settlements`; official
settlement writes only publication tables. The two ledgers share no rows, no
views and no metrics. Profile and leaderboard copy states it; the
`community-prediction-contracts` test asserts the boundary copy verbatim.
