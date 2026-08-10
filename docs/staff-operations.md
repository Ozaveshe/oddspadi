# Staff operations

OddsPadi runs two hires as product-backed roles, not informal manual work:

- **Sports Data & Market Operations Analyst** → `/ops/market`
- **Social Media & Community Manager** → `/ops/community`

Both are staff-gated (`op_profiles.is_admin` **and** `account_type='staff'`),
`noIndex`, robots-disallowed and absent from the sitemap. `/ops` is the shared
overview and [daily handover](daily-handover.md); `/ops/training` is the
[training sandbox](staff-training-mode.md).

This doc is the map. See also: [operations-service-levels.md](operations-service-levels.md),
[escalation-policy.md](escalation-policy.md),
[case-management.md](case-management.md) (state machine),
[staff-operating-system.md](staff-operating-system.md) (the underlying system).

## Role homes

Each home is organised around named **queues** — category views over the case
board, counted from the same rows the board reads (`src/lib/ops/queues.ts`), so
there is no second source of truth. Every queue shows even at zero.

**Market Operations Analyst** — slate health, stale exceptions, market-mapping
queue, result-verification queue, settlement queue, closing-price queue,
provider incidents, reconciliation mismatches, assigned cases, and the daily
handover. Dashboard tiles: open cases by severity, resolved-in-SLA, open
reconciliation errors (target 0), direct database edits (target 0, honest
floor).

**Social / Community Manager** — the moderation queue, community reports, abuse
/ safety and content-error queues, and community cases. Dashboard tiles:
moderation backlog and open community cases. Community growth, where surfaced,
counts organic accounts only — demo and staff never inflate it.

## Everything is a case

Every operational exception becomes a case (`op_operational_cases`) with the
full field set the brief asks for:

| Field | Where |
|---|---|
| case id | `id` |
| category | `category` — one of twelve (`src/lib/ops/caseCategories.ts`) |
| severity | `severity` (critical / warning / info) |
| affected entities | `detail.affectedEntities` |
| evidence | `detail.evidence` (the alert's sanitised message) |
| owner | `assignee_fingerprint` |
| SLA | `due_at` (from the case SLA policy) |
| state | `state` (the case state machine) |
| notes / actions | `op_operational_case_events` (append-only timeline) |
| escalation | `escalated_at` + the recorded escalation path |
| resolution | `resolution` + `resolved_by` |
| audit trail | one `op_operator_audit` row per action |

The twelve categories: `stale_fixture`, `stale_odds`, `identity_mismatch`,
`market_mismatch`, `result_conflict`, `settlement_exception`, `missing_close`,
`record_mismatch`, `content_error`, `user_report`, `community_abuse`,
`provider_outage`. Every alert kind and report category maps to one; an unmapped
kind falls to `record_mismatch` (visible, never dropped).

Cases open automatically from the alert queues via the scheduled sync
(`ops-case-sync-*`, `/api/ops/cases/sync`), idempotently — one open case per open
alert. A case never rewrites the alert it wraps or any immutable record.

## Quality review

Sampled second-look review of the operation's own decisions —
mappings, settlements, result verification, social copy, moderation decisions —
recorded in `op_quality_reviews` (`src/lib/ops/qualityReview.ts`,
`/api/ops/quality-reviews`). Sampling is deterministic and reproducible; a failed
review with the retraining flag set is the retraining record. Reviews are
independent of prediction outcomes.

## Escalation without back-channels

A staff member escalates a product defect **through the case**, on one of six
[defined paths](escalation-policy.md), to a known owner, with an audit trail —
never an informal message and never a direct database edit. Direct database
edits are a target-zero metric precisely because the escalation path exists.

## Known gaps (named, not silently pending)

The dashboards **enumerate every named metric** so the roles see their full
scorecard, but some are named-and-targeted without an instrumented source yet —
they render `—` (unknown), never a false zero:

- **Market**: stale-card rate, verified-result SLA, settlement SLA, mapping
  accuracy. (Closing-price coverage and reconciliation completion are wired;
  unresolved-high-priority and reconciliation-errors are computed.)
- **Community**: canonical-content usage, unsupported-claim rate (a log signal
  with no queryable source), referral traffic, response time, community growth.
  (Moderation backlog and correction rate are computed.)

Each unwired metric already has its target in `serviceTargets.ts` /
`OBSERVABILITY_METRICS`; wiring it is a read against its source, not a new
contract. Related infrastructure gaps (no CI end-to-end tests, no real-DOM axe
run, no visual-regression baseline, no push-based APM emitter, and the
reconciler's `route_error_spike` having no source table yet) are tracked in
[release-gates.md](release-gates.md) and
[production-observability.md](production-observability.md).

**Deployment**: the case tables (`op_operational_cases`, `op_operational_case_events`,
`op_quality_reviews`) and the `category` column ship as file-only migrations
(`supabase/migrations/2026080917*–19*`) applied through the normal pipeline
(`supabase db push`). Until they are live, the workspace reads degrade honestly —
a missing table is reported, never rendered as a clear queue.

## Acceptance criteria, mapped

- Each hire has a focused workspace → `/ops/market`, `/ops/community`.
- Work is case-based and auditable → `op_operational_cases` + timeline + operator audit.
- Service levels are measurable → [operations-service-levels.md](operations-service-levels.md).
- Training does not touch production → [staff-training-mode.md](staff-training-mode.md).
- Operations quality is independent of prediction outcomes → KPIs and quality
  review never read `src/lib/performance/*`.
- Staff escalate without informal messages or direct DB edits →
  [escalation-policy.md](escalation-policy.md).
