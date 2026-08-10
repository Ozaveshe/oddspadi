# Service levels

Defined once, in code, in `src/lib/ops/serviceLevels.ts`.

## SLA policy

Response and resolution deadlines by workspace and severity (minutes):

| Workspace | Severity | Respond | Resolve |
|---|---|---|---|
| market_ops | critical | 10 | 60 |
| market_ops | warning | 30 | 240 |
| market_ops | info | 120 | 1440 |
| community | critical | 30 | 240 |
| community | warning | 120 | 720 |
| community | info | 240 | 2880 |

Two orderings are invariants, asserted by test:
- **Critical is tighter than warning is tighter than info** within a workspace.
- **Market ops resolves faster than community at equal severity** — a mispriced
  market can move money; a spam report cannot.

`slaDueAt` stamps a case's `due_at` when it opens. `classifyCaseSla` returns one
of `on_track` / `due_soon` / `breached` / `resolved_in_sla` / `resolved_late`. A
resolved case is judged **once**, on whether it beat its deadline, and is never
re-flagged as breached; a case with no deadline is never breached.

## KPIs — and the one that is deliberately absent

### Prediction win rate is not an operations KPI

`serviceLevels.ts` does not import from `src/lib/performance/*`, and a test
asserts no KPI id or name references win/hit rate, ROI, yield or Brier. The
operations analyst is measured on **how the operation runs** — SLA, backlog,
data integrity — not on whether the model won. Win rate and track record live
in `src/lib/performance/*`, sourced only from the publication ledger, and are
surfaced on `/track-record` and `/engine/performance`. Mixing the two would
create exactly the incentive to "manage the record" that the publication ledger
exists to forbid.

### Market Ops Analyst (`OPS_ANALYST_KPIS`)

| KPI | Target | Direction |
|---|---|---|
| Cases resolved within SLA | 95% | higher is better |
| Median time to resolution | — | lower is better |
| Open reconciliation errors | 0 | lower is better |
| **Direct database edits (unaudited)** | **0** | lower is better |
| **Unsupported-claim rate** | **0** | lower is better |

### Social / Community Manager (`COMMUNITY_MANAGER_KPIS`)

| KPI | Target | Direction |
|---|---|---|
| Open moderation reports | — | lower is better |
| Median time to moderation action | — | lower is better |
| Organic community growth (excl. demo/staff) | — | higher is better |
| Integrity-flagged accounts | 0 | lower is better |

## The two "target zero" metrics, honestly scoped

- **Direct database edits** (`countUnauditedMutations`) counts governed
  mutations with no audit row for the same target within a 10-minute window. It
  is a **conservative floor**: it can only see mutations that the reconcilers and
  the audit trail surface. A silent edit to a table neither watches is invisible
  to it. Target zero means every governed mutation went through an audited path
  — not that no edit is conceivable.
- **Unsupported-claim rate** (`unsupportedClaimRate`) is the blocked share of
  editorial generation attempts (the `oddspadi-editorial-validation-blocked`
  signal). It is `null` — **unknown, not a satisfied zero** — when there were no
  attempts. Because `validateArticle` fails closed, a blocked claim never
  publishes; the rate measures how often generation *produced* an unsupported
  claim, and the target is that it produces none.

## Community growth excludes demo and staff

`organicGrowthPercent` reads only the `organic` cohort from the provenance
counts (`account_type`), ignoring demo, staff and system entirely — the same
exclusion the tipster leaderboard applies. Growth off a zero base returns `null`
(no rate), not "infinite growth".
