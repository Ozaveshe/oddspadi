import { canonicalSelection } from "@/lib/markets/canonicalMarkets";
import { resolveAlias, settlementRulesDiffer, type MarketAlias } from "@/lib/markets/alias";

/**
 * Translating a canonical selection into a platform's own labels.
 *
 * The one guarantee this service exists to make: it never says two selections
 * are interchangeable when settlement differs. A label that matches is not a
 * market that matches — Draw No Bet and Asian Handicap 0 read identically on a
 * slip and behave differently inside a multiple, and a tennis winner market
 * that voids on retirement is not the market we settled on the award.
 *
 * So `different_settlement` can never produce `exact`. That is asserted by a
 * test, because it is the single claim a user would act on financially.
 */

export type ConversionResult =
  | { status: "exact"; platformMarket: string; platformSelection: string; label: string }
  | {
      status: "conditional";
      platformMarket: string;
      platformSelection: string;
      label: string;
      conditions: string[];
      settlementWarning: string;
    }
  | {
      status: "settlement_warning";
      platformMarket: string;
      platformSelection: string;
      label: string;
      warning: string;
    }
  | { status: "unsupported"; reason: string }
  | { status: "unavailable"; reason: string };

export type PlatformTarget = {
  id: string;
  displayName: string;
  /** Canonical market keys this platform is known to carry. */
  supportedMarketKeys: string[];
  /** Reverse aliases: platform text keyed by canonical selection key. */
  labels: Record<string, { platformMarket: string; platformSelection: string; label: string }>;
};

export type ConversionContext = {
  platform: PlatformTarget | null;
  aliases: MarketAlias[];
  asOf: string;
};

export function convertSelection(canonicalSelectionKey: string, context: ConversionContext): ConversionResult {
  const { platform } = context;
  if (!platform) {
    return { status: "unavailable", reason: "No platform target is registered under that id." };
  }

  const resolved = canonicalSelection(canonicalSelectionKey);
  if (!resolved) {
    return { status: "unsupported", reason: `"${canonicalSelectionKey}" is not a canonical selection.` };
  }

  if (!platform.supportedMarketKeys.includes(resolved.market.key)) {
    return {
      status: "unsupported",
      reason: `${platform.displayName} does not carry ${resolved.market.key}.`
    };
  }

  const label = platform.labels[canonicalSelectionKey];
  if (!label) {
    // The platform carries the market but we have no evidence for this
    // selection's label. That is missing data, not an unsupported market, and
    // conflating the two would tell a user the bet cannot be placed when it can.
    return {
      status: "unavailable",
      reason: `No recorded ${platform.displayName} label for ${canonicalSelectionKey}; request a source refresh.`
    };
  }

  const platformAlias = context.aliases.find(
    (alias) =>
      alias.provider === platform.id &&
      alias.canonicalSelectionKey === canonicalSelectionKey &&
      alias.status === "active"
  );

  if (!platformAlias) {
    return {
      status: "unavailable",
      reason: `No approved mapping links ${platform.displayName} to ${canonicalSelectionKey}.`
    };
  }

  const resolution = resolveAlias(context.aliases, {
    provider: platformAlias.provider,
    sourceSport: platformAlias.sourceSport,
    rawMarket: platformAlias.rawMarket,
    rawSelection: platformAlias.rawSelection,
    rawLine: platformAlias.rawLine,
    asOf: context.asOf
  });

  if (resolution.status === "unmapped") {
    return { status: "unavailable", reason: resolution.reason };
  }

  // A blocked resolution still carries the alias, and its declared state is
  // what decides the answer here: `ambiguous` and `different_settlement` both
  // block resolution but mean different things to a user holding a slip.
  switch (resolution.alias.mappingState) {
    case "exact_equivalent": {
      // Belt and braces: even an alias asserting exactness is checked against
      // the declared rules, because the assertion is the thing most likely to
      // be wrong.
      const differences = platformAlias.canonicalMarketKey
        ? settlementRulesDiffer(resolved.market.key, platformAlias.canonicalMarketKey)
        : [];
      if (differences.length > 0) {
        return {
          status: "settlement_warning",
          ...label,
          warning: `Marked exact, but settlement differs: ${differences.join("; ")}. Do not treat these as interchangeable.`
        };
      }
      return { status: "exact", ...label };
    }
    case "conditionally_equivalent":
      return {
        status: "conditional",
        ...label,
        conditions: platformAlias.conditions,
        settlementWarning:
          platformAlias.conditions.length > 0
            ? `Equivalent only under: ${platformAlias.conditions.join("; ")}.`
            : "Equivalent under conditions that have not been recorded; treat with care."
      };
    case "different_settlement":
      return {
        status: "settlement_warning",
        ...label,
        warning: `${platform.displayName} settles this market differently. The label matches; the result may not.`
      };
    case "ambiguous":
      return { status: "unavailable", reason: "The mapping is ambiguous and awaiting review." };
    case "unsupported":
    case "rejected":
      return { status: "unsupported", reason: `Mapping is ${resolution.alias.mappingState}.` };
  }
}

/**
 * The reference platform target.
 *
 * OddsPadi's own exported slip format, which is the one format fully specified
 * here. Real platforms are added one at a time with their own scraped label
 * evidence and their own tests — the discipline `bookmakerAdapters.ts` already
 * chose, for the reason it gave: an importer that half-understands a format
 * produces confidently wrong analysis, which is worse than none.
 */
export const ODDSPADI_TEXT_TARGET: PlatformTarget = {
  id: "oddspadi-text",
  displayName: "OddsPadi exported slip",
  supportedMarketKeys: ["football.1x2.regulation", "football.total_goals.regulation", "football.btts.regulation"],
  labels: {
    "football.1x2.regulation.home": { platformMarket: "Match winner", platformSelection: "Home", label: "Home" },
    "football.1x2.regulation.draw": { platformMarket: "Match winner", platformSelection: "Draw", label: "Draw" },
    "football.1x2.regulation.away": { platformMarket: "Match winner", platformSelection: "Away", label: "Away" },
    "football.total_goals.regulation.over.2_5": { platformMarket: "Total goals", platformSelection: "Over 2.5", label: "Over 2.5" },
    "football.total_goals.regulation.under.2_5": { platformMarket: "Total goals", platformSelection: "Under 2.5", label: "Under 2.5" },
    "football.btts.regulation.yes": { platformMarket: "Both teams to score", platformSelection: "Yes", label: "BTTS Yes" },
    "football.btts.regulation.no": { platformMarket: "Both teams to score", platformSelection: "No", label: "BTTS No" }
  }
};

export const PLATFORM_TARGETS: PlatformTarget[] = [ODDSPADI_TEXT_TARGET];

export function platformTarget(id: string): PlatformTarget | null {
  return PLATFORM_TARGETS.find((target) => target.id === id) ?? null;
}
