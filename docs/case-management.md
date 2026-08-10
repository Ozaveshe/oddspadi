# Case management

A case (`op_operational_cases`) is one unit of operational work with an owner, a
deadline and a history. Its rules are enforced in `src/lib/ops/cases.ts` (pure,
tested) and applied through `/api/ops/cases`.

## The state machine

```
            ┌───────────────────────────────────────────────┐
            ▼                                                │
open ─→ acknowledged ─→ in_progress ⇄ waiting ─→ resolved    │ (escalate from
  │           │              │           │                   │  any non-terminal
  │           │              │           │                   │  state)
  └──── dismissed ◄──────────┴───────────┘                   │
                                                             │
  open|acknowledged|in_progress|waiting ──── escalate ───────┘
  escalated ─→ in_progress | waiting | resolved | dismissed
```

- `resolved` and `dismissed` are **terminal**. `resolved→open` is rejected. A
  recurrence opens a fresh case rather than reopening a closed decision.
- A terminal transition stamps `resolved_at` (the coherence constraint ties
  `state ∈ {resolved,dismissed}` to `resolved_at is not null`).
- Escalation stamps `escalated_at` once and preserves it across later moves.
- An illegal transition throws in the domain and returns **409** from the route,
  before any write.

## Actions

`/api/ops/cases` POST accepts: `claim`, `assign`, `note`, `acknowledge`,
`start`, `wait`, `resolve`, `dismiss`, `escalate`, `quality_review`.

- **claim / assign** set the assignee (claim → the actor; assign → a named
  fingerprint). No state change.
- **acknowledge / start / wait / resolve / dismiss** are transitions.
  `resolve`/`dismiss` require a note (the resolution) and record `resolved_by`.
- **escalate** transitions to `escalated`, may raise severity (`toSeverity`, only
  upward), and requires a note.
- **quality_review** attaches a reviewer verdict to a **resolved** case. The
  reviewer must not be the resolver (`resolved_by` ≠ actor) — a 403 otherwise,
  mirroring the moderation-appeals "different reviewer" rule. No state change.

`note`, `resolve`, `dismiss`, `escalate` and `quality_review` all require a note
of 3–2000 characters — a resolution or judgement with no words is not
accountable.

## The audit guarantee

Every applied action writes, atomically from the route's perspective:
1. one `op_operational_case_events` row (the timeline: `event_type`,
   `from_state`/`to_state`, `body`, actor fingerprint), and
2. one `op_operator_audit` row (`case_<action>`, target = case id, actor
   fingerprint, `outcome`).

The case row shows the current state; the timeline shows how it got there; the
operator audit is the cross-system record of who did what. The actor is always a
non-reversible fingerprint, never a secret.

## What a case never does

- It never edits `op_settlement_exceptions`, `op_content_reports`,
  `op_publications`, `op_fixture_results`, or any immutable record. Fixing the
  underlying problem is the existing operator-action path; the case records that
  it happened.
- It never resolves itself. Closing a case is a human decision written to the
  timeline, not a side effect of the alert clearing.

## Tables (service-role only)

`op_operational_cases` and `op_operational_case_events` have RLS on with no
authenticated/anon grants — they are read and written only through the server
routes after a staff-auth check, the same posture as the moderation tables.
Migration: `supabase/migrations/20260809170000_operational_cases.sql` (file-only
handoff).
