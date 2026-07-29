# Goal: close the OddsPadi training-data label gap

Status: ACTIVE — package prepared; live backfills intentionally not run  
Created: 2026-07-29  
Owner: OddsPadi  
Supabase project: `wncwtzqipnoqwmqlznqn`  
Target package: `training-data/standard-v1/`

## Objective

Create a reproducible, provenance-preserving training corpus that:

1. restores authoritative tennis results and set scores for OddsPadi's existing API-Tennis fixture identities;
2. makes past tennis decisions gradeable without inventing results;
3. supplies three completed seasons of Big Five football results plus explicit opening and closing 1X2 prices;
4. raises football closing-line coverage from `0.666667` to at least `0.80`;
5. records which production provider credentials are configured, active, quota-blocked, or not plan-confirmed;
6. keeps data-format readiness separate from model-promotion readiness.

## Live baseline proved on 2026-07-29

All database evidence came from the verified OddsPadi Supabase URL:
`https://wncwtzqipnoqwmqlznqn.supabase.co`.

| Evidence | Current value | Interpretation |
|---|---:|---|
| Tennis market decisions | 317,916 | Total stored decision history |
| Pending tennis decisions without a joined final score | 196,900 | Current raw ungradeable backlog for past/finished fixtures |
| Current, pending tennis decisions without a joined final score | 136,432 | Non-superseded subset |
| Distinct linked tennis fixtures | 1,608 | All use provider `api-tennis` |
| Past/finished linked tennis fixtures without scores | 1,300 | Primary score-recovery target |
| Linked tennis fixture window | 2026-07-21 through 2026-07-30 | A small date-range backfill can address the backlog |
| Latest football calibration candidate | 12 closing prices / 18 settled outcomes | `0.666667`, below the `0.80` gate |
| Minimum closing prices needed at the same 18-row denominator | 15 | Three additional valid closing prices cross the gate |

The earlier "~188k" figure was a valid prior snapshot or narrower definition. The live raw pending/unscored count is now 196,900.

## Production provider proof

| Provider | Configuration | Live proof | Plan result |
|---|---|---|---|
| API-Football | Configured | Status endpoint returned HTTP 200 and active subscription | **Ultra**, 75,000/day, 44,521 remaining at check, ends 2026-08-09 |
| API-Basketball | Configured | Status endpoint answered but reported daily limit reached | Exact plan not confirmed; treat as quota-blocked |
| API-Tennis | Configured in production | No-write request for 2026-07-28 fetched 449 matches and normalized 25 | Endpoint is active; vendor response does not expose the subscribed tier |
| The Odds API | Configured in production | Historical EPL request reached the provider but returned "Usage quota has been reached" twice | Exact production tier not confirmed; a `100k` label exists only in deploy-preview configuration and is not production proof |

The production health endpoint now reports API-Tennis configured. The prior "unconfigured" health result is stale.

## Source decision

### Primary live recovery: API-Tennis

Use API-Tennis for the settlement backfill because the 1,608 live target fixtures already carry API-Tennis identities. Its fixtures response includes `event_final_result`, inline set `scores`, point-by-point data, and statistics:

- https://api-tennis.com/documentation
- https://api-tennis.com/

Do not attempt fuzzy matching against a public corpus until the provider-ID path has been exhausted.

### Standard tennis research corpus: Tennis-Data

The package contains ATP and WTA match rows for 2024-2026 with winner/loser set totals and per-set scores:

- https://www.tennis-data.co.uk/
- https://www.tennis-data.co.uk/alldata.php

The site states that its historical results and odds files are free to use. Attribution and the retrieved source URL/hash remain attached. Its odds are not labeled as closing because the files do not provide an explicit observation timestamp or closing marker.

Jeff Sackmann's ATP/WTA repositories are not used in this production-oriented package because their CC BY-NC-SA 4.0 license prohibits commercial use:

- https://github.com/JeffSackmann/tennis_atp

### Standard football corpus: Football-Data

The package contains Premier League, Bundesliga, Serie A, La Liga, and Ligue 1 for 2023-24, 2024-25, and 2025-26:

- https://www.football-data.co.uk/data.php
- https://www.football-data.co.uk/notes.txt

Football-Data explicitly defines columns with the extra `C` after the bookmaker abbreviation as closing odds. Market Average closing H/D/A is the primary CLV source. Pinnacle remains present for comparison but is flagged because Football-Data warns its Pinnacle feed may be stale after 2025-07-23.

### Paid historical odds fallback: The Odds API

The Odds API offers historical snapshots from June 2020 (10-minute intervals), moving to 5-minute intervals from September 2022. Historical data requires a paid plan and costs 10 credits per region per market per snapshot:

- https://the-odds-api.com/historical-odds-data/
- https://the-odds-api.com/

Do not start a 2-3 season historical pull while the production quota is exhausted. Use Football-Data for the standard corpus, then reserve The Odds API for timestamped validation samples and gaps that require provider event identities.

## Canonical datasets

The package uses four flat, joinable datasets plus a source manifest:

1. `football_matches_v1`: one row per finished match and result.
2. `football_odds_v1`: one row per match, bookmaker, snapshot type, market, and selection.
3. `tennis_matches_v1`: one row per match with set totals and per-set score JSON.
4. `tennis_odds_v1`: one row per match, bookmaker, and player selection.
5. `source_manifest_v1`: one row per retrieved source file with SHA-256 and licensing notes.

Every match dataset has a stable `match_id`. Odds rows join only through that key. Source timestamps and closing timestamps are never inferred.

## Acceptance gates

### Dataset integrity

- Every required identifier, sport, date, participant, status, and source field is non-empty.
- Football final scores are non-negative integers and agree with the 1X2 result.
- Tennis match-winner labels require named winner and loser plus set totals.
- Set-market labels require completed status and at least one valid per-set score.
- Decimal odds must be greater than 1.0.
- Duplicate key rate must be 0.
- Every source file has URL, retrieval timestamp, and SHA-256.

### Coverage

- Tennis score coverage in the standard public corpus: at least `0.99`.
- API-Tennis live-backfill score coverage: at least `0.95` of the 1,300 past/finished target fixtures on the first pass; unmatched rows go to review.
- Football Market Average closing H/D/A coverage: at least `0.80`.
- Football same-bookmaker opening/closing triplet coverage: at least `0.80`.
- Latest football calibration closing-line coverage: at least `0.80` with at least 30 settled outcomes before shadow review.

### Leakage and governance

- Training features may use only observations strictly earlier than kickoff.
- Closing prices are evaluation/CLV labels, never posterior inputs for the same prediction.
- Train/validation/test splits are chronological and group identical match IDs together.
- Public data-format readiness does not activate learned weights, publish picks, or authorize staking.

## Safe execution order

1. Review `training-data/standard-v1/validation_report.json` and the workbook.
2. Run an API-Tennis no-write backfill preview for the exact live target window.
3. Require scored-row, unmatched-row, duplicate-row, and provider-error counts in the preview receipt.
4. Only after explicit operator approval, run score storage against OddsPadi project `wncwtzqipnoqwmqlznqn`.
5. Read back the 1,300 target fixtures and rerun the market-decision settlement script in dry-run mode.
6. Confirm the number of newly gradeable decisions before any settlement write.
7. Import the three-season football corpus into a staging/research table or offline trainer first.
8. Recalculate closing coverage and run chronological backtests.
9. Keep promotion locked until all calibration and governance gates pass.

Suggested no-write API-Tennis preview:

```powershell
$headers = @{ "x-oddspadi-admin-token" = $env:ODDSPADI_ADMIN_TOKEN; "Content-Type" = "application/json" }
$body = @{
  provider = "api-tennis"
  from = "2026-07-21"
  to = "2026-07-29"
  dryRun = $true
  limit = 5000
} | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://oddspadi.com/api/sports/decision/training/provider-sync" -Headers $headers -Body $body
```

This goal remains active until the live score backfill, readback, settlement dry-run, and post-backfill coverage receipts exist. The local dataset package alone does not close the live-data goal.
