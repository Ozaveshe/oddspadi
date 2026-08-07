# Canonical market ontology and Market Mapping Workbench

Design, 2026-08-07. Sits between the settlement design
([2026-08-07-result-settlement-closing-price-design.md](2026-08-07-result-settlement-closing-price-design.md))
and its implementation plan, because it changes three things in it.

## Why

The stated problem is that providers name markets differently. The measured
problem is worse: **there is no line dimension anywhere in the odds pipeline.**

- [`types.ts`](../../../src/lib/sports/types.ts) declares the market id as a
  flat string union with the line baked into the name — `over_under_25`,
  `over_under_45`, `over_under_505`, `over_under_545`, `over_under_55`,
  `over_under_585`, `over_under_65`. Seven members for one market, and every
  new line is a new member.
- `spread`, `set_handicap` and `total_games` carry **no line at all**. A
  basketball spread decision does not record the number it was taken against.
- `op_odds_snapshots` has `market text`, `selection text`, and no line column.

So an Asian handicap is not merely unmapped, it is unrepresentable: `home -0.25`
has nowhere to live. That is the underlying reason `spread` and `set_handicap`
decisions can only ever reach `needs_review`, and it would have made the
settlement design's closing-price capture unable to match a line for precisely
those markets.

Bookmaker display text is currently the identity. This design replaces it.

## Scope

In: canonical market definitions in code, a read-only database mirror, the odds
snapshot schema change, a temporal alias store, mapping states, eight quality
controls, the workbench API and CLI, the conversion service, the equivalence
suite, four documents.

Out: a web workbench page (API + CLI this pass), real bookmaker platform
adapters beyond the existing `oddspadi-text` reference adapter, collapsing the
legacy `over_under_*` union members (deferred — it touches the decision engine,
presentation and every test that names them).

## Decisions taken

| Decision | Choice | Why not the alternative |
|---|---|---|
| Canonical vs stored strings | Resolution layer, dual-read | Rewriting 335k+ historical rows is the thing the prompt forbids; raw text stays as written |
| Line dimension | Added to snapshots and the model | Without the column the ontology would describe markets the pipeline cannot capture |
| Definition home | Code, mirrored read-only to the database | Settlement semantics must not be editable data; the mirror exists only so impact queries can join |
| Workbench | Admin API + CLI | Consistent with the settlement operator surface; no authenticated UI exists in this app yet |
| Conversion targets | Service + registry, existing adapter only | Each real platform is a tested adapter added one at a time, as `bookmakerAdapters.ts` already established |

## 1. Canonical market model

### Identity

Two levels. A *market key* names what is bet on; a *selection key* names one
outcome within it.

```
market key:     <sport>.<family>.<period>
selection key:  <market key>.<selection>[.<line>]
```

```
football.1x2.regulation.home
football.double_chance.regulation.1x
football.draw_no_bet.regulation.home
football.asian_handicap.regulation.home.-0_25
football.total_goals.regulation.over.2_5
football.btts.regulation.yes
basketball.moneyline.full_game_incl_ot.home
basketball.moneyline.regulation.home
basketball.spread.full_game_incl_ot.home.-4_5
basketball.total_points.full_game_incl_ot.over.214_5
tennis.match_winner.full_match.player_a
tennis.total_games.full_match.over.22_5
```

Line encoding: the decimal point becomes `_` and the sign is preserved —
`-0_25`, `2_5`, `0`, `214_5`.

**Deviation from the brief, recorded deliberately.** The brief wrote
`basketball.moneyline.full_game.include_overtime.home`, with overtime as its own
segment. This design folds it into the period segment
(`full_game_incl_ot` vs `regulation`) because a segment that is mandatory for
basketball and meaningless for tennis cannot be parsed without first knowing the
sport. The information is identical; the grammar is context-free.

### The definition record

This *is* the settlement design's `MarketRule`, extended rather than duplicated:

```ts
type CanonicalMarket = {
  key: "football.asian_handicap.regulation";
  version: "2026-08-07.1";
  sport: "football" | "basketball" | "tennis";
  family: string;                  // "asian_handicap"
  period: string;                  // "regulation" | "full_game_incl_ot" | "full_match"
  participantScope: "match" | "team_home" | "team_away" | "player" | "either";
  selectionType: "binary" | "ternary" | "handicap" | "total" | "exact_score";
  lineRequired: boolean;
  lineGranularity: "none" | "integer" | "half" | "quarter";
  overtimeRule: "excluded" | "included" | "not_applicable";
  pushRule: "exact_line_push" | "half_line_no_push" | "quarter_line_half_push" | "no_push";
  voidRule: "void_on_no_result" | "void_on_abandonment" | "settle_if_awarded";
  retirementRule: "settle_on_award" | "void" | "not_applicable";
  settlementRuleVersion: "2026-08-07.1";
  selections: CanonicalSelection[];
};
```

Every rule field is a closed union, so an unhandled case is a compile error and
never a silent default.

`settlementRuleVersion` is the join to the settlement design: the ontology
*declares* the semantics and the rule registry *executes* them. A parity test
asserts that every canonical market resolves to a grade function whose behaviour
matches its declared overtime, push, void and retirement values. If declaration
and implementation disagree, the build fails. That is what keeps one source of
settlement truth across the two designs.

### Versions are append-only

A definition is never edited in place. A change to settlement semantics adds
`2026-08-07.2` and leaves `.1` in the registry, so a settlement recorded against
`.1` stays resolvable forever. This makes "historical records cannot be silently
remapped" true at the definition layer, not only at the alias layer.

### The mirror

`op_canonical_markets` and `op_canonical_selections` are populated only by
migration, with `insert`, `update` and `delete` revoked from every role
including the service key. They exist so the workbench can join impact queries
in SQL against the largest tables rather than paging them into application
memory.

A test compares the mirror against the code registry and fails on any
divergence. The mirror is a cache and is documented as one.

## 2. Odds snapshot schema

One migration on the largest table, designed once for three prompts.

`op_odds_snapshots` gains:

| Column | Purpose |
|---|---|
| `line numeric` | The handicap or total. Null where `lineRequired` is false. |
| `snapshot_class text` | `opening`, `intermediate`, `decision_time`, `closing` |
| `outlier_state text` | `normal`, `suspect_overround`, `suspect_price`, `excluded` |

**Source depth is derived, not stored.** A snapshot row is one book's quote, so
a depth column on it would be a denormalised count of its siblings — wrong the
moment another book reports. The historical-odds read layer computes depth per
(fixture, canonical selection, time bucket), and the settlement design already
stores the depth that mattered at capture on `op_closing_prices.source_count`,
where it is a fact about a decision rather than about a row.

**Migration order for `is_closing`.** The corpus-imported rows carry
`is_closing = true` and no class. The migration therefore runs in three steps:
backfill `snapshot_class = 'closing'` wherever `is_closing` is true, then point
`op_mark_closing_odds()` at `snapshot_class`, and only then replace `is_closing`
with a generated column reading `snapshot_class = 'closing'`. Reversing steps
one and three would drop the corpus's closing flags on the floor.

Backfill: `line` is derived from the legacy market name where the name encodes
it (`over_under_25` → `2.5`). Where it does not — `spread`, `set_handicap`,
`total_games` — the line stays null and those rows are reported as
`line_unrecoverable` in the coverage output. They are not guessed.

Forward writes populate both the legacy `market`/`selection` text and the new
`line`, so the dual-read resolution below has data on both sides.

## 3. Aliases

`op_market_aliases`:

| Group | Columns |
|---|---|
| Source key | `provider`, `source_sport`, `raw_market`, `raw_selection`, `raw_line`, `participant_order` |
| Target | `canonical_market_key`, `canonical_selection_key` (null unless the state permits a mapping) |
| Judgement | `mapping_state`, `confidence`, `evidence jsonb`, `notes` |
| Temporal | `effective_from`, `effective_to`, `version`, `supersedes_alias_id` |
| Workflow | `status` (`draft`, `pending_review`, `active`, `retired`), `reviewer`, `reviewed_at` |

`participant_order` ∈ `as_listed`, `reversed`, `unknown`. A `reversed` alias
swaps home and away at resolution time.

### Resolution is temporal

```ts
resolveAlias(provider, rawMarket, rawSelection, rawLine, asOf): AliasResolution
```

The resolver returns the alias **effective at `asOf`**, not the current one. A
June odds snapshot resolves through June's alias, so approving a better mapping
today cannot change what a June decision meant.

This is the structural answer to "do not silently remap historical official
records": it is a property of the lookup signature, not a policy anyone has to
remember. An exclusion constraint prevents two active versions of one source key
from overlapping in time.

### Mapping states

| State | Odds comparison | Slip conversion | Settlement |
|---|---|---|---|
| `exact_equivalent` | yes | `exact` | yes |
| `conditionally_equivalent` | yes, flagged | `conditional` + warning | yes, condition recorded |
| `different_settlement` | **no** | `settlement_warning`, never `exact` | no |
| `unsupported` | no | `unsupported` | no |
| `ambiguous` | no | `unavailable` | no |
| `rejected` | no | `unsupported` | no |

### The named hard cases, decided

- **Draw No Bet vs Asian Handicap 0** — `conditionally_equivalent`, condition
  `accumulator_treatment_differs`. Identical single-bet payout; a void leg and a
  push leg behave differently inside a multiple, so they are not interchangeable
  in every context.
- **1X2 including extra time vs regulation only** — `different_settlement`.
  Distinct canonical markets, never interchangeable. This is the case most
  likely to corrupt a public record silently.
- **Basketball moneyline where the provider does not state overtime treatment**
  — `ambiguous` until evidence resolves it, never defaulted.
- **Tennis winner where a platform voids on retirement while OddsPadi settles on
  the award** — `different_settlement`.
- **Asian quarter lines** — distinct canonical selections (`.-0_25`). Never
  collapsed into a neighbouring half line. A provider emitting a quarter line
  the canonical model does not carry maps `unsupported`, not "nearest".
- **Participant reversal and orientation changes** — `participant_order`,
  applied at resolution and checked by the orientation validator below.

## 4. Quality controls

Each is a named check producing a typed failure. All run on alias write *and* as
a sweep, writing into the settlement design's `op_settlement_exceptions` with
new kinds — one operations queue for the whole pipeline, not a third.

| Check | Fails when |
|---|---|
| `duplicate_alias` | Two active aliases share a source key with overlapping effective windows (exclusion constraint plus sweep) |
| `impossible_line` | Total below zero; Asian line not a multiple of 0.25; a line present on a market with `lineRequired: false`; a line absent where it is required |
| `participant_orientation` | Alias orientation disagrees with the fixture's home/away, or the selection ordering in the raw payload contradicts the declared order |
| `market_completeness` | A ternary canonical market has fewer than three selections mapped for a provider; binary fewer than two |
| `market_set_completeness` | An odds snapshot set is missing a selection, so the market cannot be de-vigged |
| `overround_sanity` | Summed implied probability outside the sport's configured band (default 1.00–1.30) |
| `incompatible_settlement` | An alias claims `exact_equivalent` while the two canonical markets differ on any of overtime, push, void or retirement. **Rejected at write time**, not merely flagged |
| `version_conflict` | Two active alias versions for one source key, or an alias pointing at a retired canonical market version |

## 5. Workbench

Admin API under `/api/admin/markets/`, token-guarded by the existing
`ODDSPADI_ADMIN_TOKEN` check in
[`intelligence/auth.ts`](../../../src/lib/sports/intelligence/auth.ts):

| Route | Action |
|---|---|
| `GET sources` | Search source markets by provider, sport, mapping state, with volume counts |
| `GET candidates` | Ranked candidate canonical mappings with the reason for each: token overlap, line parse, selection-type fit, aliases other providers already use |
| `GET compare` | Side-by-side settlement rules for a candidate pair, differences highlighted |
| `GET receipts` | Example odds snapshots and raw payloads that produced this raw market |
| `GET impact` | The pre-approval impact preview |
| `POST aliases` | Create a versioned alias as `draft` |
| `POST aliases/:id/approve` | Approve — requires a matching impact token |
| `POST aliases/:id/reject` | Reject with reason |
| `POST aliases/:id/review` | Send an ambiguous mapping to review |
| `POST refresh` | Request another source refresh |
| `GET queue` | Mappings awaiting review |

CLI: `ops:market-sources`, `ops:market-candidates`, `ops:market-impact`,
`ops:market-approve` (dry run by default).

### Impact preview is a gate, not a display

`GET impact` returns the five required counts — fixtures affected, odds
snapshots affected, decisions affected, Bet Workspaces affected, unsettled
publications affected — computed by joining the mirror tables.

It also returns an `impact_token`: a hash of the counts and the alias body the
analyst was shown. `POST approve` requires that token. If the underlying data
moved between preview and approval, the token mismatches and approval is
refused with the fresh counts.

Approving against a stale preview is otherwise the easiest way to cause exactly
the damage the workbench exists to prevent.

### Mandatory review

**A limitation to state plainly.** The admin surface authenticates with one
shared `ODDSPADI_ADMIN_TOKEN`. There are no per-analyst identities, so "a second
analyst must approve" cannot be *authenticated* — only *recorded*. Every
workbench call therefore carries a required `actor` string, stored on the alias
and on the operator-action log, and approval is refused when `actor` equals the
alias's creator. That is accountability, not access control: someone holding the
token can supply any actor string. It is worth having anyway, because it makes
an unreviewed approval visible in the audit trail rather than indistinguishable
from a reviewed one. Real per-analyst authentication is a separate scope, and
this design does not pretend to provide it.

Self-approval is refused, and the mapping must be reviewed by a second recorded
actor, when any of:

- official publications exist against the affected source key
- fixtures affected exceed the threshold (default 50)
- the two canonical markets differ on any settlement rule
- the provider has no active aliases yet (a new provider)
- the ingestion run's parser version differs from the one the alias was built
  against (parser drift)

### Historical corrections

Approving an alias never rewrites stored rows. It creates a new version with
`effective_from = now()`.

Changing what history means requires an explicit, auditable migration:
`scripts/remap-historical-aliases.ts`, dry run by default, writing one audit row
per affected record with the before state, the after state and the reason. There
is no code path from the workbench to a historical rewrite.

## 6. Slip conversion

```ts
convertSelection(canonicalSelectionKey, platformId, context): ConversionResult
```

```ts
type ConversionResult =
  | { status: "exact"; platformMarket: string; platformSelection: string; label: string }
  | { status: "conditional"; platformMarket: string; platformSelection: string;
      label: string; conditions: string[]; settlementWarning: string }
  | { status: "settlement_warning"; platformMarket: string; platformSelection: string;
      label: string; warning: string }
  | { status: "unsupported"; reason: string }
  | { status: "unavailable"; reason: string };
```

`settlement_warning` is the case where a label matches but settlement differs —
the platform has the market, and using it would not reproduce our result.

**Hard rule:** an alias in `different_settlement` can never produce `exact`.
Enforced in the service and asserted by a test, because "do not claim that two
selections are interchangeable when settlement differs" is the one thing this
service exists to guarantee.

The platform registry extends
[`bookmakerAdapters.ts`](../../../src/lib/workspace/bookmakerAdapters.ts), whose
`supportedMarkets` field moves from loose strings to canonical market keys.
`oddspadi-text` is the one registered target this pass.

## 7. Amendments to the settlement design

Three, and they are why this design had to come first.

1. `op_odds_snapshots` gains `line`, `snapshot_class`, `source_depth` and
   `outlier_state`. Closing-price capture matches on `line`, without which
   Asian handicap and spread picks could never capture a close. `is_closing`
   becomes derived from `snapshot_class`.
2. `resolveMarket(providerName, sport)` is replaced by
   `resolveAlias(..., asOf)`. Settlement resolves a historical claim through
   the alias that was effective when the claim was made.
3. `MarketRule` becomes the executable half of `CanonicalMarket`, and the rule
   id *is* the canonical market key. The parity test in section 1 replaces the
   separate rule-version bookkeeping the settlement design assumed.

## 8. Tests

`src/test/market-equivalence.test.ts` — football 1X2; double chance; draw no
bet; Asian handicap 0; Asian quarter handicaps; over/under; BTTS; basketball
moneyline and spread; overtime inclusion; tennis match winner; retirement
policies; reversed participants; bookmaker alias changes; unsupported props.

Supporting suites:

- **Temporal resolution** — an alias approved today does not change what a
  snapshot from last month resolves to.
- **Mirror parity** — `op_canonical_markets` matches the code registry.
- **Declaration parity** — every canonical market's declared overtime, push,
  void and retirement rules match the behaviour of its grade function.
- **Quality controls** — one case per check, including `incompatible_settlement`
  rejected at write time rather than flagged.
- **Impact token staleness** — approval refused when counts moved.
- **Conversion** — `different_settlement` never returns `exact`.
- **Line backfill** — `over_under_25` yields 2.5; `spread` yields null and is
  reported, not guessed.

## 9. Documentation

New: `docs/market-ontology.md`, `docs/provider-market-mapping.md`,
`docs/platform-conversion.md`, `docs/market-mapping-review.md`.

Updated: the settlement design's `docs/market-settlement-rules.md` points at the
canonical keys; `docs/data-coverage-matrix.md` gains the line-recoverability
report.

## Phases

1. Canonical market registry in code, mirror migration, mirror and declaration
   parity tests.
2. Odds snapshot schema change, line backfill with an unrecoverable report,
   ingestion writing both representations.
3. Alias store, temporal resolver, the eight quality controls, seeded from the
   mappings currently hardcoded in the provider adapters.
4. Workbench API, CLI, impact preview and token, review triggers.
5. Conversion service and platform registry.
6. The four documents.

Phase 2 is the only one touching the largest table, and its backfill is
report-first: the unrecoverable set is reviewed before anything is written.

## Acceptance

- No code path treats provider display text as canonical identity; the market
  string union in `types.ts` is no longer the identity, only a legacy label.
- Every supported canonical market declares overtime, push, void and retirement
  rules, and a test proves the executable rule agrees.
- An analyst can create, review and approve a mapping through the API and CLI
  without a direct database edit.
- Ambiguous equivalence is a first-class state that blocks comparison,
  conversion and settlement rather than degrading quietly.
- Conversion carries a settlement warning wherever settlement differs, and
  cannot report `exact` in that case.
- Approving a mapping cannot alter what a historical record meant; only an
  audited migration can, and it records every row it changed.
