# Legacy reconciliation audit

Generated 2026-07-31T16:47:45.082Z · mode: dry run

## Totals

- **Total legacy objects inspected:** 1,083,525
- **Official picks recovered:** 0
- internal decision: 1,083,163
- shadow decision: 328
- backtest record: 25
- editorial observation: 8
- simulation: 1
- community selection: 0

## Recovery detail

- Candidates examined (op_public_picks): 0
- Records missing timestamps: 0
- Records missing odds: 0
- Records missing fixture identity: 0
- Records published at or after kickoff: 0
- Records requiring manual review: 0
- Conflicting settlements: 0

## Store-by-store

| Store | Class | Rows | Note |
|---|---|---|---|
| `op_public_picks` | official_public_pick (candidate) | 0 | The intended official ledger. |
| `op_market_decisions` | internal_decision | 491,739 | Per-market engine decisions; training evidence, never publicly claimed. |
| `op_prediction_outcomes` | internal_decision | 1,319 | Graded internal decisions reconstructed from market decisions. |
| `op_fixture_decision_summaries` | internal_decision | ≈590,105 | Canonical per-fixture decision summaries behind the slate. (planner estimate; exact count exceeds the statement timeout) |
| `op_prediction_outcomes` | shadow_decision | 143 | Paper-mode candidate runs. Explicitly not public. |
| `op_shadow_predictions` | shadow_decision | 42 | Challenger predictions held in shadow. |
| `op_public_prediction_outcomes` | shadow_decision | 143 | Shadow rows that were reaching the anon-readable mirror before the allowlist fix. |
| `op_public_prediction_outcomes` | simulation | 1 | Developer smoke-test rows found in the public mirror. |
| `op_backtest_runs` | backtest_record | 25 | Historical replays. Never live performance. |
| `op_editorial_stories` | editorial_observation | 8 | Generated stories. Commentary about picks, never picks. |
| `op_community_tips` | community_selection | 0 | Visitor tips. Separate ledger, separate leaderboard. |
| `op_community_tip_settlements` | community_selection | 0 | Settlements for community tips. |
