import { convertSelection, type ConversionResult, type PlatformTarget } from "@/lib/markets/conversion";
import type { MarketAlias } from "@/lib/markets/alias";
import type { CanonicalSelection } from "@/lib/workspace/selection";

/**
 * Platform view: what a leg looks like on another platform's slip.
 *
 * This is a thin, honest wrapper over the Market Mapping service. The
 * discipline it inherits, stated once here for the workspace's benefit:
 *
 * - Only platforms in the registered target list are offered. There is no
 *   "all bookmakers" answer, because we have label evidence for specific
 *   platforms and silence about the rest.
 * - `different_settlement` never reads as equivalent. A settlement warning on
 *   a conversion is the one line a user acts on financially, so it is passed
 *   through verbatim, never summarised away.
 * - A leg without a canonical key has no conversion — the reason is stated
 *   instead of a lookalike label being guessed from the legacy id.
 */

export type LegPlatformView = {
  platformId: string;
  platformName: string;
  result: ConversionResult;
  /** One user-facing sentence; warnings always survive into it. */
  summary: string;
};

export function platformViewForLeg(
  selection: CanonicalSelection,
  platform: PlatformTarget,
  aliases: MarketAlias[],
  asOf: string
): LegPlatformView {
  if (!selection.canonicalSelectionKey) {
    return {
      platformId: platform.id,
      platformName: platform.displayName,
      result: {
        status: "unavailable",
        reason: "This leg's market has no canonical mapping yet, so no platform equivalent can be named."
      },
      summary: "No platform equivalent can be shown for this market yet."
    };
  }

  const result = convertSelection(selection.canonicalSelectionKey, { platform, aliases, asOf });
  return {
    platformId: platform.id,
    platformName: platform.displayName,
    result,
    summary: summarise(platform.displayName, result)
  };
}

function summarise(platformName: string, result: ConversionResult): string {
  switch (result.status) {
    case "exact":
      return `On ${platformName}: "${result.platformMarket} — ${result.platformSelection}". Settlement rules match.`;
    case "conditional":
      return `On ${platformName}: "${result.platformMarket} — ${result.platformSelection}". ${result.settlementWarning}`;
    case "settlement_warning":
      return `On ${platformName}: "${result.platformMarket} — ${result.platformSelection}". Warning: ${result.warning}`;
    case "unsupported":
      return `${platformName} does not carry this market. ${result.reason}`;
    case "unavailable":
      return `No verified ${platformName} equivalent is on record. ${result.reason}`;
  }
}
