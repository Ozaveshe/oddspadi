# Reproducing the standard-v1 package

This package is a dated, provenance-preserving snapshot. Rebuilding it requires
network access to the source URLs in `datasets/source_manifest.csv` and the
Codex bundled spreadsheet runtime used to read source XLSX files and generate
the review workbook.

## Exact rebuild

From `training-data/standard-v1/` in a Codex workspace with the spreadsheet
runtime loaded:

```powershell
node tools/build-standard-training-data.mjs
node tools/verify-standard-training-data.mjs
```

The verifier must finish with `"result": "pass"`. It writes
`verification_receipt.json` and checks:

- row counts and unique match IDs;
- football score/result agreement;
- tennis completed-match score consistency and exclusion flags for anomalous,
  retired, walkover, or awarded rows;
- odds-to-match joins, duplicate quote keys, and decimal odds greater than 1;
- Market Average closing coverage and same-bookmaker opening/closing coverage;
- SHA-256 equality with `validation_report.json`.

## Source and normalization contract

1. Download every URL recorded in `datasets/source_manifest.csv`.
2. Compare the downloaded byte hash with `source_sha256`. A mismatch means the
   upstream file changed and a new dated package version is required.
3. Football match rows come from the result and final-score columns documented
   by Football-Data. Opening prices use ordinary bookmaker columns; closing
   prices use the documented extra-`C` columns. Never infer an observation time.
4. Tennis `player_1` is the source winner and `player_2` the source loser.
   Completed rows are gradeable only when the per-set game scores agree with
   that winner. Retirements, walkovers, awards, and contradictory completed
   rows stay in the corpus with both gradeable flags set to `false`.
5. Tennis odds remain `is_closing=false` because the source does not prove an
   exact closing marker or observation timestamp.
6. Emit the exact columns and types in `schemas/*.schema.json`, then rerun the
   independent verifier before training or evaluation.

The public tennis corpus is suitable for research and model training after
applying the gradeable flags. It is not an identity-perfect substitute for the
live API-Tennis fixture backfill described in the goal document.
