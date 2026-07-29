# OddsPadi standard training-data package v1

Generated: 2026-07-29  
Live database writes: none  
Primary goal: `docs/training-data-goal-2026-07-29.md`

## What is included

| File | Grain | Purpose |
|---|---|---|
| `datasets/football_matches_2023_24_to_2025_26.csv` | one row per match | Big Five results and final scores |
| `datasets/football_odds_opening_closing_2023_24_to_2025_26.csv` | one row per quote | Opening and explicit closing 1X2 prices |
| `datasets/tennis_matches_with_scores_2024_to_2026.csv` | one row per match | ATP/WTA winner, loser, set totals, and per-set scores |
| `datasets/tennis_match_odds_2024_to_2026.csv` | one row per quote | Tennis match-winner prices without an unsupported closing claim |
| `datasets/source_manifest.csv` | one row per source file | Provenance, SHA-256, retrieval time, and terms note |
| `schemas/*.schema.json` | one row contract per dataset | Machine-readable field contract |
| `validation_report.json` | one package receipt | Counts, coverage gates, hashes, provider proof, and warnings |
| `verification_receipt.json` | one independent receipt | Row counts, joins, duplicates, odds ranges, score/result consistency, coverage, and hashes |
| `odds_padi_training_data_standard_v1.xlsx` | review workbook | Human-readable catalog, gates, sources, and samples |
| `REPRODUCING.md` and `tools/*.mjs` | rebuild contract | Source refresh, normalization, workbook generation, and independent verification |

## Design rules

- Flat CSVs: one record per row and one variable per column.
- Stable `match_id` joins match and odds datasets.
- Raw source values are preserved where possible; quality issues are explicit flags.
- No score, kickoff time, odds timestamp, closing marker, provider plan, or license is guessed.
- Football columns ending in closing `C` are normalized as closing because Football-Data explicitly documents that convention.
- Tennis odds remain `is_closing=false` because Tennis-Data does not provide an explicit closing marker or observation timestamp.
- Retired, walkover, and awarded tennis rows retain their source result and partial score, but both gradeable flags are `false`; train/evaluate only rows whose relevant gradeable flag is `true`.
- Closing odds may evaluate CLV but must not leak into a pre-kickoff model feature vector.
- Public corpora are research/training inputs; production promotion remains a separate governance decision.

## Recommended loading order

1. Load the source manifest and verify hashes.
2. Load match rows and reject duplicate `match_id` values.
3. Load odds rows and require every `match_id` to exist in its match dataset.
4. Apply quality flags before selecting a primary bookmaker/consensus.
5. Split chronologically by match date.
6. Fit only on pre-kickoff features.
7. Evaluate outcomes and closing-line value on holdout rows.

## Primary football closing rule

Use the complete `Market Average` closing H/D/A triplet as the default closing consensus. Use Bet365 or Pinnacle only as sensitivity checks. Pinnacle rows dated on or after 2025-07-23 carry a source warning and should not be the sole closing benchmark.

## Tennis live-backfill boundary

The public ATP/WTA corpus is not a direct replacement for the live OddsPadi score gap. The live target fixtures already use API-Tennis identities, so the production API-Tennis provider backfill must be attempted first. Fuzzy date/name matching is a review-only fallback.

## Sources

- API-Tennis documentation: https://api-tennis.com/documentation
- API-Tennis plans: https://api-tennis.com/
- Tennis-Data: https://www.tennis-data.co.uk/alldata.php
- Football-Data: https://www.football-data.co.uk/data.php
- Football-Data field notes: https://www.football-data.co.uk/notes.txt
- The Odds API historical data: https://the-odds-api.com/historical-odds-data/
- The Odds API plans: https://the-odds-api.com/
- Jeff Sackmann license boundary: https://github.com/JeffSackmann/tennis_atp

Review `validation_report.json` before using any file.
Use `REPRODUCING.md` for the exact rebuild and verification sequence.
