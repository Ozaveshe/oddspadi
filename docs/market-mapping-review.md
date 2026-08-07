# Market mapping review

*Workbench: `/api/admin/markets/*`. Storage: `op_market_aliases`. Audit:
`op_settlement_operator_actions`.*

The review process an alias goes through before it can affect a price
comparison, a slip conversion or a settlement.

## Lifecycle

```
draft ──▶ pending_review ──▶ active ──▶ retired
  │                            ▲
  └────────── rejected ────────┘
```

A draft affects nothing. Only `active` aliases resolve.

## Impact preview is a gate, not a display

`GET /api/admin/markets/impact` returns five counts, computed by joining the
canonical mirror against the live tables:

- fixtures affected
- odds snapshots affected
- decisions affected
- Bet Workspaces affected
- unsettled publications affected

It also returns an `impact_token` — a hash of the counts and the alias body the
analyst was shown. `POST approve` **requires that token**. If the underlying
data moved between preview and approval, the token mismatches and approval is
refused with the fresh counts.

Approving against a stale preview is otherwise the easiest way to cause exactly
the damage the workbench exists to prevent: an analyst reads "3 fixtures
affected", a sweep lands 400 more, and the approval goes through against a
number that was true a minute ago.

## When review is mandatory

Self-approval is refused and a second recorded actor must approve when any of:

- **official publications exist** against the affected source key
- **fixtures affected exceed the threshold** (default 50)
- **settlement rules differ** between the two canonical markets
- **the provider is new** — no active aliases exist for it yet
- **the source parser changed** — the ingestion run's parser version differs
  from the one the alias was built against

The last is parser drift, and it is the quietest of the five: the mapping was
correct against the text the old parser produced, and nothing about the alias
itself changed.

## A limitation, stated plainly

The admin surface authenticates with one shared `ODDSPADI_ADMIN_TOKEN`. There
are no per-analyst identities, so "a second analyst must approve" cannot be
*authenticated* — only *recorded*.

Every workbench call carries a required `actor` string, stored on the alias and
in the operator log, and approval is refused when `actor` equals the alias's
creator. Someone holding the token can supply any actor string.

This is accountability, not access control. It is worth having because an
unreviewed approval becomes visible in the audit trail rather than
indistinguishable from a reviewed one. Real per-analyst authentication is a
separate scope, and nothing here should be read as providing it.

## What an approval does and does not do

**Does:** create a new alias version with `effective_from = now()`, retire the
previous version, and record the actor, the reviewer and the impact token.

**Does not:** rewrite a single stored row. Historical snapshots and decisions
keep resolving through the alias that was effective when they were written —
see [provider-market-mapping.md](provider-market-mapping.md).

Changing what history means requires `scripts/remap-historical-aliases.ts`, dry
run by default, writing one audit row per affected record with the before state,
the after state and the reason. There is no path from the workbench to a
historical rewrite, and that is deliberate rather than an omission.

## Reviewer checklist

1. **Orientation.** Does the provider list home first? An alias with
   `participant_order = 'unknown'` cannot go active, and getting this wrong
   inverts every claim on that market.
2. **Line.** Does the granularity match? A quarter line on a half-line market is
   refused; a quarter line mapped to its nearest half is worse, because it
   passes.
3. **Settlement.** Read the platform's actual rules, not its market names. Use
   `GET compare` — it shows the two markets' declared overtime, push, void and
   retirement rules side by side.
4. **State.** Is `exact_equivalent` honest? If any condition applies, the state
   is `conditionally_equivalent` and the condition goes in `conditions`. The
   write is refused if you claim both.
5. **Evidence.** Are there example receipts on the alias? An approval with no
   evidence cannot be re-reviewed later.
6. **Impact.** Read the counts. If publications are affected, this is a
   correction to a public record, not a mapping.
