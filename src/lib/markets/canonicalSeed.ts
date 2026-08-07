import { formatSelectionKey } from "@/lib/markets/canonicalKey";
import { CANONICAL_MARKETS } from "@/lib/markets/canonicalMarkets";

/**
 * Render the canonical market registry as the mirror seed migration.
 *
 * The mirror exists so the mapping workbench can join impact queries in SQL
 * against the largest tables. Hand-writing its INSERT statements would create a
 * second place where settlement semantics are stated, and the two would diverge
 * — most likely at the moment a rule changes, which is the worst possible time.
 *
 * So the seed is generated from the registry, and a test regenerates it and
 * compares against the file on disk. A registry change with no regenerated seed
 * fails the build rather than shipping a mirror that quietly describes the
 * previous rules.
 */

export const CANONICAL_SEED_PATH = "supabase/migrations/20260807100600_canonical_market_seed.sql";

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function buildCanonicalSeedSql(): string {
  const marketRows = CANONICAL_MARKETS.map(
    (market) =>
      "  (" +
      [
        quote(market.key),
        quote(market.version),
        quote(market.sport),
        quote(market.family),
        quote(market.period),
        quote(market.participantScope),
        quote(market.selectionType),
        String(market.lineRequired),
        quote(market.lineGranularity),
        quote(market.basis),
        quote(market.overtimeRule),
        quote(market.pushRule),
        quote(market.voidRule),
        quote(market.retirementRule),
        quote(market.settlementRuleVersion),
        quote(market.settlementBasisStatement)
      ].join(", ") +
      ")"
  ).join(",\n");

  const selectionRows = CANONICAL_MARKETS.flatMap((market) =>
    market.selections.map(
      (selection) =>
        "  (" +
        [
          quote(formatSelectionKey(market.key, selection.id)),
          quote(market.key),
          quote(selection.id),
          quote(selection.label)
        ].join(", ") +
        ")"
    )
  ).join(",\n");

  return `-- GENERATED FILE - do not edit by hand.
--
-- Produced from src/lib/markets/canonicalMarkets.ts via
-- src/lib/markets/canonicalSeed.ts. The registry is the source of truth; this
-- mirror exists only so the mapping workbench can join impact queries in SQL.
--
-- canonical-market-mirror.test.ts regenerates this file and compares, so a
-- registry change without a regenerated seed fails the build rather than
-- shipping a mirror describing the previous rules.
--
-- Regenerate with: npm run docs:canonical-seed
--
-- Selection keys here carry no line: a line is a property of a quote, not of a
-- selection's identity in the registry. The full key with its line
-- (football.asian_handicap.regulation.home.-0_25) is formed at resolution.

delete from public.op_canonical_selections;
delete from public.op_canonical_markets;

insert into public.op_canonical_markets (
  key, version, sport, family, period, participant_scope, selection_type,
  line_required, line_granularity, basis, overtime_rule, push_rule, void_rule,
  retirement_rule, settlement_rule_version, settlement_basis_statement
) values
${marketRows};

insert into public.op_canonical_selections (key, market_key, selection, label) values
${selectionRows};
`;
}
