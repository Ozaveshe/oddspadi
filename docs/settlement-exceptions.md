# Settlement and closing exceptions

*Storage: `op_settlement_exceptions`. Operator log:
`op_settlement_operator_actions`.*

One queue for settlement, closing-price and market-mapping problems. Two queues
would mean two places to look and two backlogs to forget about.

## Kinds

### Settlement

| Kind | Raised when |
|---|---|
| `result_conflict` | Observations disagree, the event stream contradicts the score, or a single observation timed out at six hours |
| `unknown_market` | A claim's market resolves to no canonical key |
| `missing_line` | A handicap or total claim carries no line |
| `ambiguous_retirement` | A retirement whose award cannot be determined |
| `abandoned_fixture` | An abandoned fixture with a published claim against it |
| `duplicate_result` | More than one current result row for a fixture |
| `missing_participant_identity` | A participant cannot be matched to a canonical entity |
| `provider_correction` | A provider revised a result after we verified it |

### Closing

| Kind | Raised when |
|---|---|
| `close_missing` | An eligible pick has no close and no more specific reason |
| `close_insufficient_sources` | Fewer than the minimum books priced the selection |
| `close_identity_failure` | Identity could not be resolved at capture |
| `close_market_unmapped` | No alias maps the market, so no quote matches |
| `close_late_data` | Every quote arrived after kickoff |

### Mapping

`alias_duplicate`, `alias_impossible_line`, `alias_orientation`,
`alias_incompatible_settlement`, `alias_version_conflict`, `alias_overround`.

## Severity

| Level | Means |
|---|---|
| `critical` | A published claim is wrong or unsettleable — every result conflict, duplicate result and provider correction |
| `warning` | A claim is degraded but honest — missing close, insufficient sources |
| `info` | Worth knowing, no claim affected — an unknown market on an unpublished decision |

## One open row per problem

A partial unique index covers `(kind, fixture, publication, market, selection)`
where `state = 'open'`. An hourly sweep touching the same unresolved exception
updates `last_seen_at` rather than growing a pile — which would make the queue
useless at precisely the moment it matters.

States: `open` → `acknowledged` → `resolved` or `dismissed`. A resolved or
dismissed row must carry `resolved_at`, enforced by check constraint.

## Alerts

Derived at read time from this queue and the SLA thresholds, never stored. A
persisted alert ledger can disagree with the exceptions it describes; a derived
alert cannot outlive the condition that caused it.

| Alert | Condition | Severity |
|---|---|---|
| `result-unverified-sla` | Terminal ≥3h, not verified | critical |
| `pick-unsettled-sla` | Result verified ≥1h, pick still unsettled | critical |
| `close-missing-near-cutoff` | Kickoff under 30min, eligible pick, depth below minimum | warning |
| `result-conflict` | Any open conflict exception | critical |
| `settlement-correction` | A verdict superseded in the last 24h | warning |
| `mass-void` | Void share above 15% of ≥10 settlements in 24h | critical |
| `provider-result-lag` | Median final→first-observation above 90min over 24h | warning |

`ops:alerts` follows the `reconcile-truth` contract: exit 0 clean, 1 critical
findings, 2 could not complete. **It never reports zero on failure** — an
unreadable source is a finding of its own and forces exit 2. That rule exists
because the first draft of `reconcile-truth` wrapped its reads in
`.catch(() => [])` and duly announced "0 projections" against a store holding
six.

## Operator actions

Every action appends to `op_settlement_operator_actions` with `actor`,
`action`, `target`, `payload` and `evidence`.

`actor` is **caller-supplied, not authenticated**. The admin surface holds one
shared `ODDSPADI_ADMIN_TOKEN` and there are no per-analyst identities, so this
is accountability rather than access control: someone holding the token could
supply any actor string. It is worth having because an unreviewed approval
becomes visible in the trail instead of indistinguishable from a reviewed one.
Real per-analyst authentication is a separate scope and is not claimed here.

## What an operator may not do

- Set a verdict directly. They choose an applicable **rule**; no endpoint
  accepts an outcome string, so "settle this as won" is not expressible.
- Edit a published probability, price or timestamp. No admin route writes to
  `op_publications`, and a test asserts it.
- Turn a missing close into a number. `operator_unavailable` is a status with a
  required reason.
