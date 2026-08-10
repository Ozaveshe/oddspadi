# Operations service levels

Three layers, each defined once in code.

## 1. Case SLA policy (`src/lib/ops/serviceLevels.ts`)

Per-case response and resolution deadlines by workspace × severity. Critical is
tighter than warning is tighter than info; market ops resolves faster than
community at equal severity (a mispriced market can move money; a spam report
cannot). `classifyCaseSla` judges a resolved case once — on whether it beat its
deadline — and never re-flags it as breached. Full table in
[service-levels.md](service-levels.md).

## 2. Configurable service targets (`src/lib/ops/serviceTargets.ts`)

The eight operational targets the operation is held to, each with a default and
a direction:

| Target | Default | Direction |
|---|---|---|
| Current-surface stale-card rate | 2% | lower is better |
| Result verification delay | 180 min | lower is better |
| Official settlement delay | 60 min | lower is better |
| Closing-price coverage | 90% | higher is better |
| Market-mapping review time | 240 min | lower is better |
| High-priority incident response | 15 min | lower is better |
| Community report response | 720 min | lower is better |
| Content correction time | 120 min | lower is better |

**Configurable without a code change.** Set `ODDSPADI_OPS_SLA_OVERRIDES` to a
JSON map, e.g. `{"settlement_delay":45,"closing_price_coverage":92}`. Unknown
ids and non-number values are ignored; malformed JSON falls back to the defaults.
`meetsTarget(id, value)` is direction-aware and returns `null` for an unmeasured
target — an unmeasured target is never a satisfied one.

## 3. Dashboard metrics (`src/lib/ops/dashboardMetrics.ts`)

Operations: stale-card percentage, verified-result SLA, settlement SLA,
closing-price coverage, mapping accuracy, unresolved high-priority cases,
**direct database edits (target 0)**, reconciliation completion.

Community: canonical-content usage, correction rate, **unsupported-claim rate
(target 0)**, referral traffic, response time, moderation backlog, **community
growth excluding demo/staff posts**.

The two target-zero metrics are honestly scoped: direct-database-edits is a
conservative floor (it sees only mutations the audit trail and reconcilers
surface), and unsupported-claim rate is `null` over zero attempts rather than a
satisfied zero. Growth counts organic accounts only.

## Prediction win rate is not an operations KPI

None of the three layers imports from `src/lib/performance/*`, and tests assert
no target, KPI id or name references win/hit rate, ROI, yield or Brier. The
operation is measured on how it runs — SLA, backlog, data integrity, coverage —
never on whether the model won. Win rate and track record live separately, on
`/track-record` and `/engine/performance`, sourced only from the publication
ledger. Blending them would create the incentive to manage the record that the
ledger exists to forbid.
