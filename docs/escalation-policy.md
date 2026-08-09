# Escalation policy

Escalation is how a staff member hands a case that outgrows the workspace to a
known owner — **through the product**, with an audit trail, never through an
informal message or a direct database edit. The paths are defined in
`src/lib/ops/escalation.ts`.

## The six paths

| Path | Trigger | Routes to | Severity floor |
|---|---|---|---|
| **security** | credential exposure, auth bypass, injection, suspected intrusion | Security lead + engineering on-call | critical |
| **data_corruption** | immutable-record mismatch, ledger anomaly, unexplained mass state change | Data-integrity owner — stop writes, second reviewer | critical |
| **legal_community_safety** | illegal content, threats, minors, defamation, regulated-market exposure | Legal/compliance + community lead | critical |
| **mass_provider_failure** | an upstream provider down or wrong at scale | Market-ops lead + engineering on-call | critical |
| **model_contradiction** | a public surface contradicts the model or itself | Modelling owner + editorial | warning |
| **public_record_correction** | a published pick or track-record figure is wrong | Publication owner — append a correction, never edit | warning |

Targets are roles, never named people, so the policy survives staffing changes.

## How to escalate

`POST /api/ops/cases` with `action: "escalate"`, a note, and optionally an
`escalationPath` (one of the six ids) and a `toSeverity`. If the path is omitted,
the default for the case's category is used
(`escalationPathForCategory`): identity/record mismatches → `data_corruption`,
provider outage → `mass_provider_failure`, community abuse →
`legal_community_safety`, result/settlement/content issues →
`public_record_correction`. A category with no obvious owner returns no default
— the analyst names the path rather than misrouting.

The escalation stamps `escalated_at`, may raise severity, and records the path on
the timeline event, the operator-audit row, and the response. The case is now
owned by the escalation target; it is not resolved until the underlying defect is
fixed at its source.

## What escalation is not

- It is **not** a fix. Escalating routes ownership; the correction still happens
  on the proper path (a ledger correction is appended, a settlement is re-run, a
  mapping is added). A case is resolved only when the source is corrected.
- It is **not** a database edit. No escalation path licenses editing an immutable
  record. `data_corruption` explicitly says *stop writes* and get a second
  reviewer — the opposite of a quiet fix.
- It is **not** a back-channel. If it did not go through the case, it did not
  happen — there is no audit trail for a Slack message.

## Related

- [case-management.md](case-management.md) — the case state machine and audit.
- [staff-operations.md](staff-operations.md) — the roles and workspaces.
- [incident-and-rollback.md](incident-and-rollback.md) — the technical reversal
  procedures an escalation may trigger.
