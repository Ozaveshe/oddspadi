# Official standings

The official table derives only from provider standings (API-Football) or
stored snapshots (`op_standings_snapshots`) — never from simulations, and
never recomputed locally from results.

## The one builder

`buildOfficialTable` (`src/lib/discovery/tableState.ts`) is the single
authority, and since 2026-08-09 the table page **renders its output** (it
previously computed and discarded it):

- **Pre-season** (`matchesPlayed === 0` across the league): state
  `season-not-started`, label "Season not started", rows alphabetical with
  **no position property** — an all-zero table cannot imply rank. Zone
  styling and movement arrows are suppressed; the position cell shows "—".
- **In-season**: ranked by net points → goal difference → goals for → name
  (disclosed; per-competition tiebreaks like head-to-head are NOT implemented).
  `verifiedAt`/update time is shown.
- **Unavailable**: the builder's note renders; no raw rows fall through.

## Deductions

`StandingRow`/`LeagueStandingRow` carry `pointsAdjustment` + `adjustmentNote`.
Ranking always uses the net `points` the competition records; the adjustment
is a display annotation ("−6 pts: points deduction"). Provider payloads that
express deductions inside `points` therefore rank correctly even without the
annotation.

## Freshness (stale provider tables)

`classifyTableFreshness(updatedAt)` → `current` / `delayed` (>24 h) /
`unavailable` (no timestamp). The note renders beside the Updated line. Known
caveat: the provider path stamps fetch time behind two caches (up to ~3 h 15 m
of hidden age); the 24 h threshold is deliberately generous.

## Postponed / abandoned fixtures and corrections

Standings are provider-authoritative: a postponed or abandoned fixture changes
the table only when the provider republishes it. Entity-page **scores** are
correction-aware separately: `applyCurrentResult` lets only the CURRENT,
VERIFIED `op_fixture_results` revision override a provider score
(result-correction propagation), and abandoned fixtures appear in results
lists as what they are. The match page's inline "Nth · N pts" is guarded by
the same pre-season rule.

## Not implemented (stated, not hidden)

Per-competition tiebreak rules; basketball standings (no approved source —
the adapter renders the absence note); local standings recomputation from
verified results.
