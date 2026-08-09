# Production observability

The signals OddsPadi watches, and their thresholds. The registry is code —
`src/lib/observability/metrics.ts` (`OBSERVABILITY_METRICS`) — so a threshold is
stated once and never drifts between here and the alerting.

## Signals

| Signal | Warn | Page | Source |
|---|---|---|---|
| Public read latency (p95) | 800 ms | 2500 ms | load-test / route budgets |
| Route failure rate | 1% | 10% | reconciler `route_error_spike` / handler logs |
| Projection age | 15 min | 60 min | `op_public_projections.built_at` |
| Fixture import lag | 2 h | 6 h | `op_fixtures.last_synced_at` |
| Odds import lag | 90 min | 4 h | `op_odds_snapshots.observed_at` |
| Model-run lag | 60 min | 2 h | `op_provider_ingestion_runs` |
| Settlement lag | 60 min | 4 h | publications vs `op_fixture_results.final_at` |
| Closing-line coverage | < 90% | < 80% | `op_closing_prices` captured / eligible |
| Reconciliation errors | ≥ 1 | ≥ 1 | `op_settlement_exceptions` kind `reconciler_*` open |
| Identity failures | ≥ 1 | ≥ 5 | exception kinds `*_identity_*` |
| Stale-card rate | 2% | 10% | slate rows with availability `stale` |
| Contradiction count | ≥ 1 | ≥ 1 | `prohibited-contradictions.test.tsx` (CI) |
| Moderation backlog | 20 | 100 | `op_content_reports` open |
| Content-validation failures | ≥ 1 | ≥ 5 | editorial validation-blocked log |

`classifyMetric(id, value)` applies these in the correct direction (higher-is-worse
for latency/lag, lower-is-worse for coverage) and returns `unknown` for an unread
signal — an unread signal is never a false "ok".

## Where they surface today

- **Public**: `/api/status` (operational/delayed/partial/unavailable + last update)
  and `/api/health` (readiness booleans). Neither leaks provider names, run ids,
  or raw errors.
- **Operator scripts**: `npm run ops:health` (site-health canary),
  `ops:reconcile-truth`, `ops:alerts` (settlement/closing SLA), `ops:loadtest`
  (p95). The scheduled `production-reconciler` writes reconciliation findings to
  the exception queue.
- **Projection freshness** is enforced at read time (`readProjection` →
  `stale`/`unavailable`, never a zero).

## Gap (documented follow-up)

There is no metrics-emitter/APM integration (Datadog/PagerDuty) in code — the
signals are read on demand by scripts and the status endpoints. A push emitter
would read this same registry.
