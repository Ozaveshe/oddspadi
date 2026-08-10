# Staff operating system

Two accountable role workspaces sit on top of the alert queues the rest of the
system produces. Nothing here invents a new source of truth — it gives humans a
place to own the problems the machines detect.

## The two roles

- **Market Ops Analyst** (`/ops/market`) — settlement, closing-price, mapping
  and reconciliation cases. Measured on how the operation runs, never on whether
  the model won (see [service-levels.md](service-levels.md)).
- **Social / Community Manager** (`/ops/community`) — the moderation queue plus
  community cases (e.g. an orphaned community selection). Community growth is
  counted on organic accounts only.

Both pages are staff-gated (`op_profiles.is_admin` **and**
`account_type='staff'`), `noIndex`, robots-disallowed and absent from the
sitemap. `/ops` is the overview and [daily handover](daily-handover.md).

## Where cases come from

A case is the human-work layer above an alert. The alert queues already exist:

- `op_settlement_exceptions` — settlement/closing/mapping exceptions, plus the
  `reconciler_*` findings the scheduled reconciler writes (see
  [cross-surface-reconciliation.md](cross-surface-reconciliation.md)).
- `op_content_reports` — community moderation reports.

`op_operational_cases` wraps one open alert and adds what the alert lacks: an
**assignee**, an **SLA clock**, a **timeline**, and a **state machine**. It never
edits the alert it wraps, and never an immutable record — resolving the
underlying problem stays the existing operator-action path; the case records
that a human did the work.

```
op_settlement_exceptions (reconciler_*, settlement, mapping)  ─┐
                                                               ├─→ op_upsert_operational_case ─→ op_operational_cases
op_content_reports (community moderation)                     ─┘        (idempotent, one open case per open alert)
```

The mapping lives in `src/lib/ops/cases.ts`: an orphaned community selection
routes to the community workspace, everything else to market ops.

## How a case moves

A legal state machine (`CASE_TRANSITIONS`) governs every move:

```
open ─→ acknowledged ─→ in_progress ⇄ waiting ─→ resolved
  └────────────────────────┴──────────┴────────→ dismissed
  every non-terminal state ─→ escalated ─→ (in_progress | waiting | resolved | dismissed)
```

`resolved` and `dismissed` are terminal — a recurrence opens a fresh case rather
than reviving a closed decision, the same rule the alert queue enforces. Every
action is applied through `/api/ops/cases` and writes **one** timeline event
(`op_operational_case_events`) **and one** operator-audit row
(`op_operator_audit`). See [case-management.md](case-management.md).

## Sync

`op_upsert_operational_case` is idempotent, so the scheduled sync
(`ops-case-sync-{sweep,worker-background}`, `12,42 * * * *` → `/api/ops/cases/sync`)
can run every half hour: a second run for the same open alert returns the
existing case, never a duplicate. An unreadable alert queue opens **nothing**
(502) — a half-synced board is worse than one that declined. `npm run ops:cases`
is the read-only SLA report.

## Auth

- **Machine** (the sweep worker, ops scripts): the shared admin bearer token,
  fingerprinted for the audit via `actorTokenFingerprint`.
- **UI** (a staff member): a cookie session that is `is_admin` and
  `account_type='staff'`, fingerprinted from the profile id.

`requireStaff` accepts either and fails closed. The actor is a non-reversible
fingerprint in both cases — the audit records *which* credential acted, never
the secret.

## Migration handoff

`supabase/migrations/20260809170000_operational_cases.sql` is a file-only
handoff (the Supabase MCP connector is unauthenticated in this session), like
every other migration on this branch. It must be applied for the workspace to
read or write cases.
