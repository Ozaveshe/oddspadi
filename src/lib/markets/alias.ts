import { canonicalMarket, canonicalSelection, type CanonicalMarket } from "@/lib/markets/canonicalMarkets";

/**
 * Provider and platform aliases.
 *
 * The mapping from a bookmaker's display text to a canonical selection, and —
 * the part that does the real work — *when* that mapping was true.
 *
 * Resolution takes an `asOf` timestamp and returns the alias effective then,
 * not the one effective now. A June odds snapshot resolves through June's
 * alias, so approving a better mapping today cannot change what a June decision
 * meant. "Do not silently remap historical official records" is therefore a
 * property of this function's signature rather than a policy somebody has to
 * remember at each call site.
 */

export type MappingState =
  | "exact_equivalent"
  | "conditionally_equivalent"
  | "different_settlement"
  | "unsupported"
  | "ambiguous"
  | "rejected";

export type ParticipantOrder = "as_listed" | "reversed" | "unknown";

export type AliasStatus = "draft" | "pending_review" | "active" | "retired";

export type MarketAlias = {
  id: string;
  provider: string;
  sourceSport: string;
  rawMarket: string;
  rawSelection: string;
  rawLine: string | null;
  participantOrder: ParticipantOrder;

  canonicalMarketKey: string | null;
  canonicalSelectionKey: string | null;

  mappingState: MappingState;
  confidence: number;
  conditions: string[];
  evidence: Record<string, unknown>;
  /**
   * Free text for the reviewer. Deliberately excluded from the impact token:
   * editing it changes nothing the mapping does, and forcing a re-preview for a
   * typo fix trains people to click through the preview that matters.
   */
  notes?: string | null;

  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  supersedesAliasId: string | null;

  status: AliasStatus;
  createdBy: string;
  reviewer: string | null;
  reviewedAt: string | null;
};

/** States in which the alias names a canonical selection we are willing to act on. */
const MAPPED_STATES = new Set<MappingState>(["exact_equivalent", "conditionally_equivalent", "different_settlement"]);

/** States that permit settlement and odds comparison. */
const SETTLEABLE_STATES = new Set<MappingState>(["exact_equivalent", "conditionally_equivalent"]);

export function isSettleable(state: MappingState): boolean {
  return SETTLEABLE_STATES.has(state);
}

export function isComparable(state: MappingState): boolean {
  return SETTLEABLE_STATES.has(state);
}

export type AliasQuery = {
  provider: string;
  sourceSport: string;
  rawMarket: string;
  rawSelection: string;
  rawLine?: string | null;
  asOf: string;
};

export type AliasResolution =
  | { status: "resolved"; alias: MarketAlias; selectionKey: string; market: CanonicalMarket }
  | { status: "blocked"; alias: MarketAlias; reason: string }
  | { status: "unmapped"; reason: string };

function normalise(value: string): string {
  return value.trim().toLowerCase();
}

function matchesKey(alias: MarketAlias, query: AliasQuery): boolean {
  return (
    normalise(alias.provider) === normalise(query.provider) &&
    normalise(alias.sourceSport) === normalise(query.sourceSport) &&
    normalise(alias.rawMarket) === normalise(query.rawMarket) &&
    normalise(alias.rawSelection) === normalise(query.rawSelection) &&
    normalise(alias.rawLine ?? "") === normalise(query.rawLine ?? "")
  );
}

function effectiveAt(alias: MarketAlias, asOf: string): boolean {
  if (alias.effectiveFrom > asOf) return false;
  return alias.effectiveTo === null || alias.effectiveTo > asOf;
}

export function resolveAlias(aliases: MarketAlias[], query: AliasQuery): AliasResolution {
  const candidates = aliases.filter(
    (alias) => alias.status === "active" && matchesKey(alias, query) && effectiveAt(alias, query.asOf)
  );

  if (candidates.length === 0) {
    return { status: "unmapped", reason: `No active alias for ${query.provider}/${query.rawMarket}/${query.rawSelection} as of ${query.asOf}.` };
  }
  if (candidates.length > 1) {
    // Two live mappings for one source key is a data defect, and picking one
    // would settle claims against a coin flip. The exclusion constraint should
    // make this unreachable; the check exists because "should" is not "does".
    return {
      status: "blocked",
      alias: candidates[0]!,
      reason: `${candidates.length} active aliases overlap at ${query.asOf}; the mapping is ambiguous until one is retired.`
    };
  }

  const alias = candidates[0]!;
  if (!MAPPED_STATES.has(alias.mappingState) || !alias.canonicalSelectionKey) {
    return { status: "blocked", alias, reason: `Alias is ${alias.mappingState}, which does not name a usable canonical selection.` };
  }
  const resolved = canonicalSelection(alias.canonicalSelectionKey);
  if (!resolved) {
    return { status: "blocked", alias, reason: `Alias points at "${alias.canonicalSelectionKey}", which is not in the canonical registry.` };
  }
  return { status: "resolved", alias, selectionKey: alias.canonicalSelectionKey, market: resolved.market };
}

/**
 * Apply a reversed participant order to a resolved selection.
 *
 * A provider that lists the away side first turns `home` into `away` and back.
 * Applied at resolution rather than at ingest, because ingest has already
 * written the raw text and rewriting it would destroy the evidence that the
 * reversal happened.
 */
export function applyOrientation(selection: string, order: ParticipantOrder): string {
  if (order !== "reversed") return selection;
  const swaps: Record<string, string> = {
    home: "away",
    away: "home",
    player_a: "player_b",
    player_b: "player_a",
    "1x": "x2",
    x2: "1x"
  };
  return swaps[selection] ?? selection;
}

// ---------------------------------------------------------------- validation

export type AliasDefect = {
  check:
    | "duplicate_alias"
    | "impossible_line"
    | "participant_orientation"
    | "market_completeness"
    | "market_set_completeness"
    | "overround_sanity"
    | "incompatible_settlement"
    | "version_conflict";
  severity: "critical" | "warning" | "info";
  detail: string;
};

export type OverroundBand = { min: number; max: number };

export const DEFAULT_OVERROUND_BAND: OverroundBand = { min: 1.0, max: 1.3 };

/**
 * Checks run on alias write.
 *
 * `incompatible_settlement` is the one that rejects rather than flags: an alias
 * claiming two markets are exactly equivalent while their settlement rules
 * differ is the precise defect that turns a comparison into a wrong result, and
 * a flag on it would be a note attached to a live mapping.
 */
export function validateAlias(alias: MarketAlias, existing: MarketAlias[]): AliasDefect[] {
  const defects: AliasDefect[] = [];

  const overlapping = existing.filter(
    (other) =>
      other.id !== alias.id &&
      other.status === "active" &&
      matchesKey(other, {
        provider: alias.provider,
        sourceSport: alias.sourceSport,
        rawMarket: alias.rawMarket,
        rawSelection: alias.rawSelection,
        rawLine: alias.rawLine,
        asOf: alias.effectiveFrom
      }) &&
      windowsOverlap(alias, other)
  );
  if (overlapping.length > 0) {
    defects.push({
      check: "duplicate_alias",
      severity: "critical",
      detail: `Overlaps ${overlapping.length} active alias(es) for the same source key: ${overlapping.map((other) => other.id).join(", ")}.`
    });
  }
  if (overlapping.some((other) => other.version === alias.version)) {
    defects.push({
      check: "version_conflict",
      severity: "critical",
      detail: `Version ${alias.version} already exists and is active for this source key.`
    });
  }

  if (alias.canonicalSelectionKey && !canonicalSelection(alias.canonicalSelectionKey)) {
    const market = alias.canonicalMarketKey ? canonicalMarket(alias.canonicalMarketKey) : null;
    defects.push({
      check: "impossible_line",
      severity: "critical",
      detail: market
        ? `"${alias.canonicalSelectionKey}" does not fit ${market.key}: it requires ${market.lineRequired ? `a ${market.lineGranularity} line` : "no line"}.`
        : `"${alias.canonicalSelectionKey}" is not a valid canonical selection.`
    });
  }

  if (alias.participantOrder === "unknown" && MAPPED_STATES.has(alias.mappingState)) {
    defects.push({
      check: "participant_orientation",
      severity: "critical",
      detail: "Participant order is unknown, so home and away cannot be assigned; the mapping would be a coin flip."
    });
  }

  if (alias.mappingState === "exact_equivalent" && alias.conditions.length > 0) {
    defects.push({
      check: "incompatible_settlement",
      severity: "critical",
      detail: `Claimed exact_equivalent while carrying ${alias.conditions.length} condition(s); a conditional mapping is conditionally_equivalent.`
    });
  }

  if (alias.confidence < 0 || alias.confidence > 1) {
    defects.push({ check: "market_completeness", severity: "critical", detail: `Confidence ${alias.confidence} is outside [0, 1].` });
  }

  return defects;
}

function windowsOverlap(a: MarketAlias, b: MarketAlias): boolean {
  const aEnd = a.effectiveTo ?? "9999-12-31T23:59:59.999Z";
  const bEnd = b.effectiveTo ?? "9999-12-31T23:59:59.999Z";
  return a.effectiveFrom < bEnd && b.effectiveFrom < aEnd;
}

/**
 * Reject an alias that claims exact equivalence across differing settlement.
 *
 * Compares the declared rules of two canonical markets rather than their names.
 * Draw No Bet and Asian Handicap 0 pay identically on a single bet, which is
 * why a name comparison would pass them; they differ on push versus void, which
 * changes how a leg behaves inside a multiple.
 */
export function settlementRulesDiffer(a: string, b: string): string[] {
  const left = canonicalMarket(a);
  const right = canonicalMarket(b);
  if (!left || !right) return ["one or both markets are not in the canonical registry"];
  const differences: string[] = [];
  if (left.basis !== right.basis) differences.push(`basis ${left.basis} vs ${right.basis}`);
  if (left.overtimeRule !== right.overtimeRule) differences.push(`overtime ${left.overtimeRule} vs ${right.overtimeRule}`);
  if (left.pushRule !== right.pushRule) differences.push(`push ${left.pushRule} vs ${right.pushRule}`);
  if (left.voidRule !== right.voidRule) differences.push(`void ${left.voidRule} vs ${right.voidRule}`);
  if (left.retirementRule !== right.retirementRule) differences.push(`retirement ${left.retirementRule} vs ${right.retirementRule}`);
  return differences;
}

export function checkOverround(
  impliedProbabilities: number[],
  band: OverroundBand = DEFAULT_OVERROUND_BAND
): AliasDefect | null {
  if (impliedProbabilities.length < 2) {
    return { check: "market_set_completeness", severity: "warning", detail: "Fewer than two selections priced; the market cannot be de-vigged." };
  }
  const sum = impliedProbabilities.reduce((total, value) => total + value, 0);
  if (sum < band.min || sum > band.max) {
    return {
      check: "overround_sanity",
      severity: "warning",
      detail: `Summed implied probability ${sum.toFixed(4)} is outside the ${band.min}–${band.max} band.`
    };
  }
  return null;
}

export function checkMarketCompleteness(market: CanonicalMarket, mappedSelections: string[]): AliasDefect | null {
  const expected = market.selections.length;
  const present = new Set(mappedSelections).size;
  if (present < expected) {
    return {
      check: "market_completeness",
      severity: "warning",
      detail: `${market.key} has ${present} of ${expected} selections mapped; an incomplete market cannot be compared or de-vigged.`
    };
  }
  return null;
}
