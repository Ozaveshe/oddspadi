# Provider market mapping

*Implementation: [`alias.ts`](../src/lib/markets/alias.ts). Storage:
`op_market_aliases`. Canonical targets:
[market-ontology.md](market-ontology.md).*

## Resolution is temporal

```ts
resolveAlias(aliases, { provider, sourceSport, rawMarket, rawSelection, rawLine, asOf })
```

The resolver returns the alias **effective at `asOf`**, not the one effective
now. A June odds snapshot resolves through June's alias, so approving a better
mapping today cannot change what a June decision meant.

That is the structural answer to "do not silently remap historical official
records": a property of the lookup signature, not a policy somebody has to
remember at each call site.

Correcting what history means is still possible, but only through
`scripts/remap-historical-aliases.ts` — dry run by default, one audit row per
record it changes. There is no path from the workbench to a historical rewrite.

## The alias record

| Group | Fields |
|---|---|
| Source key | `provider`, `source_sport`, `raw_market`, `raw_selection`, `raw_line`, `participant_order` |
| Target | `canonical_market_key`, `canonical_selection_key` |
| Judgement | `mapping_state`, `confidence`, `conditions`, `evidence`, `notes` |
| Temporal | `effective_from`, `effective_to`, `version`, `supersedes_alias_id` |
| Workflow | `status`, `created_by`, `reviewer`, `reviewed_at` |

A gist exclusion constraint prevents two active aliases for one source key from
overlapping in time — the conflict is an overlap, not an equality, so a unique
index could not express it. If two ever do overlap, resolution **blocks** rather
than picking one; settling claims on a coin flip is worse than settling none.

## Mapping states

| State | Odds comparison | Slip conversion | Settlement |
|---|---|---|---|
| `exact_equivalent` | Yes | `exact` | Yes |
| `conditionally_equivalent` | Flagged | `conditional` + warning | Yes, condition recorded |
| `different_settlement` | **No** | `settlement_warning`, never `exact` | No |
| `unsupported` | No | `unsupported` | No |
| `ambiguous` | No | `unavailable` | No |
| `rejected` | No | `unsupported` | No |

Only the first three name a canonical selection, enforced by check constraint.

## The hard cases, decided

**Draw No Bet vs Asian Handicap 0** — `conditionally_equivalent`, condition
`accumulator_treatment_differs`. Identical single-bet payout, which is why a
name comparison would call them equivalent; they differ on push versus void, and
a void leg and a push leg behave differently inside a multiple.

**1X2 including extra time vs regulation only** — `different_settlement`.
Distinct canonical markets, never interchangeable. The case most likely to
corrupt a public record silently.

**Basketball moneyline where the provider does not state overtime treatment** —
`ambiguous` until evidence resolves it. Never defaulted.

**Tennis winner where a platform voids on retirement** — `different_settlement`,
because OddsPadi settles on the award.

**Asian quarter lines** — distinct canonical selections (`.-0_25`). A provider
emitting a quarter line the canonical model does not carry maps `unsupported`,
not "nearest". Rounding settles a claim against a line nobody quoted.

**Participant reversal** — `participant_order`, applied at resolution rather
than at ingest. Rewriting the raw text at ingest would destroy the evidence that
the reversal happened.

## Quality controls

| Check | Fails when |
|---|---|
| `duplicate_alias` | Two active aliases share a source key with overlapping windows |
| `impossible_line` | A line not fitting the market's granularity, absent where required, or present where the market carries none |
| `participant_orientation` | Order is `unknown` on a mapping that names a selection — home and away would be a coin flip |
| `market_completeness` | Fewer selections mapped than the canonical market declares |
| `market_set_completeness` | An odds set missing a selection, so the market cannot be de-vigged |
| `overround_sanity` | Summed implied probability outside the sport's band (default 1.00–1.30) |
| `incompatible_settlement` | `exact_equivalent` claimed while the rules differ. **Refused at write time**, not flagged |
| `version_conflict` | Two active versions for one source key |

`settlementRulesDiffer(a, b)` compares the two markets' *declared* rules rather
than their names, so it catches Draw No Bet against Asian Handicap 0 where a
name comparison would not.

Checks run on alias write and as a sweep, writing into
`op_settlement_exceptions` under the `alias_*` kinds. See
[settlement-exceptions.md](settlement-exceptions.md).

## Adding a provider

1. Collect raw market and selection text with example receipts.
2. Create draft aliases, one per source key.
3. Resolve orientation before anything else — an alias with unknown order
   cannot go active.
4. A new provider always requires review; see
   [market-mapping-review.md](market-mapping-review.md).
