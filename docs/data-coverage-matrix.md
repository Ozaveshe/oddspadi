# Data coverage matrix

Measured against production on **2026-08-02**. Exact counts, not planner
estimates — the estimated count reads 0 on any table that has not been
`ANALYZE`d, which is the same "looks empty but isn't" trap the product spends
so much effort avoiding elsewhere.

## Store sizes

| Table | Rows | What it holds |
|---|---:|---|
| `op_odds_snapshots` | 1,487,081 | Priced markets over time |
| `op_fixture_decision_summaries` | 703,493 | Per-fixture decision rollups |
| `op_market_decisions` | 628,755 | Engine conclusions per market |
| `op_fixtures` | 28,145 | Canonical fixtures |
| `op_teams` | 6,364 | Canonical teams |
| `op_provider_ingestion_runs` | 6,736 | Job receipts |
| `op_prediction_outcomes` | 2,028 | Graded outcomes |
| `op_calibration_runs` | 154 | Calibration snapshots |
| `op_backtest_runs` | 25 | Stored replays |
| `op_public_projections` | 6 | Public read model |
| **`op_publications`** † | **0** | **The official ledger** |
| `op_publication_revisions` † | 0 | Corrections |
| `op_publication_settlements` † | 0 | Graded publications |
| `op_calibration_promotions` | 0 | Promoted calibrators |
| `op_community_tips` | 0 | Member selections |

† **Superseded.** Publication opened on 2026-08-03. Re-measured 2026-08-07, the
three ledger tables hold **230**, **50** and **134** rows. The rest of this
table is left at its 2026-08-02 values; a snapshot with mixed dates is worse
than a stale one, because nothing in it tells you which rows are which.

## The number that matters

**628,755 decisions. 2,028 graded outcomes. 230 official publications** — of
which 84 are settled, as of 2026-08-07.

Raw volume is not usable training data, and the brief is explicit about not
treating it as such. The chain from a stored decision to evidence about model
quality has three narrowings:

1. **Decisions → outcomes: 2,028 / 628,755 ≈ 0.32%.** Almost every decision the
   engine has ever made is ungraded. A decision without a settled outcome
   contributes nothing to calibration.
2. **Outcomes → official publications: 230, settled 84.** The ledger opened on
   2026-08-03 and the second narrowing is now the binding one: 84 graded public
   claims against 2,028 graded internal outcomes. The other 1,944 are internal
   decisions and shadow runs — legitimate training evidence, but not a public
   track record, and the record-class allowlist is what keeps them out.
3. **Publications → closing-line evidence.** Every publication carries an odds
   snapshot id at publication time, so closing-line value is measurable for the
   public product for the first time — on 230 rows, which is far too few to
   conclude anything yet. It is no longer structurally unmeasurable, which is a
   different statement from being measured.

## What this implies for the engine brief

The engine brief asks for chronological evaluation against strong baselines,
promotion gated on out-of-sample improvement, and honest closing-line
measurement. Against the measured state:

| Phase | Feasible now? | Why |
|---|---|---|
| Audit and coverage (1) | **Yes** — this document | Counts are available. |
| Point-in-time integrity (2) | **Yes** | 1.49M odds snapshots carry `captured_at`; provenance columns exist. |
| Identity resolution (3) | **Yes** | 28k fixtures, 6.4k teams, aliases modelled. |
| Odds intelligence (4) | **Yes** | The snapshot volume genuinely supports this. |
| Strong baselines (5) | **Partly** | 2,028 graded outcomes is enough for a market-vs-model comparison on football, thin elsewhere. |
| Candidate stack + ensemble (6) | **Partly** | Sample size limits how much model capacity is justifiable. |
| Time-ordered validation (7) | **Yes** | Timestamps support walk-forward splits. |
| Calibration (8) | **Partly** | 154 calibration runs exist; segment-level calibrators would be over-fitted at this sample size. |
| Uncertainty (9) | **Yes** | Does not depend on sample size. |
| Decision policy (10) | **Yes** — already versioned | Thresholds exist and are configurable per sport. |
| Closing-line value (11) | **Partly** | Unblocked 2026-08-03. All 230 publications carry an odds snapshot id and price at publication; 230 rows is too thin to conclude from. |
| Backtest realism (12) | **Partly** | Odds history supports it; void/settlement realism needs the graded set. |
| Model evaluation (13) | **Blocked on 5–8** | |
| Promotion and shadow (16) | **Machinery exists**, nothing promoted | `op_calibration_promotions` is empty. |

## Honest conclusion

The measurement infrastructure is real and the odds corpus is substantial. The
*evaluation* corpus is not: 2,028 graded outcomes across three sports, and 84
settled public claims, is not enough to claim a promoted model beat a baseline.

Publication opening on 2026-08-03 changed the shape of the problem without
changing that conclusion. Closing-line value went from unmeasurable to
measurable-on-230-rows, which is progress in kind rather than in quantity. The
correct next step is still to raise the graded count — settle more decisions,
widen the outcome backfill, keep publishing — and any promotion decision taken
before that would be made on a sample that cannot support it.

Regenerate the store sizes before quoting them; they move daily.
