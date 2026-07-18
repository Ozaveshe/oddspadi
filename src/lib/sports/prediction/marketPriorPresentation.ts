import type { MarketPriorAdjustment, OddsMarket } from "@/lib/sports/types";
import { formatPercent } from "./format";

export type MarketPriorReceipt = MarketPriorAdjustment["markets"][number];

export type MarketPriorPresentation = {
  state: "broad" | "supported" | "mixed" | "disputed" | "thin" | "single" | "missing";
  label: string;
  detail: string;
  influenceLabel: string | null;
};

export function marketPriorReceiptFor(
  adjustment: MarketPriorAdjustment | null | undefined,
  marketId: OddsMarket["id"] | string
): MarketPriorReceipt | null {
  return adjustment?.markets.find((market) => market.marketId === marketId) ?? null;
}

export function buildMarketPriorPresentation(receipt: MarketPriorReceipt | null | undefined): MarketPriorPresentation {
  if (!receipt) {
    return {
      state: "missing",
      label: "Market depth unavailable",
      detail: "This receipt does not record how many bookmakers supported the market probability.",
      influenceLabel: null
    };
  }

  const influenceLabel = `${formatPercent(receipt.weight)} prior influence`;
  if (receipt.priorMethod === "selected-quote-no-vig") {
    return {
      state: "single",
      label: "Single-book reference",
      detail: "One executable quote informed the prior; no cross-book agreement is claimed.",
      influenceLabel
    };
  }

  const spread = receipt.maxProbabilitySpread ?? 0;
  const depth = `${receipt.bookmakerCount} bookmaker${receipt.bookmakerCount === 1 ? "" : "s"}`;
  const disagreement = `${formatPercent(spread)} widest probability gap`;
  if (spread > 0.1) {
    return { state: "disputed", label: "Bookmakers split", detail: `${depth} / ${disagreement}.`, influenceLabel };
  }
  if (receipt.bookmakerCount < 3) {
    return { state: "thin", label: "Thin consensus", detail: `${depth} / ${disagreement}.`, influenceLabel };
  }
  if (receipt.bookmakerCount >= 5 && spread <= 0.03) {
    return { state: "broad", label: "Broad market agreement", detail: `${depth} / ${disagreement}.`, influenceLabel };
  }
  if (receipt.bookmakerCount >= 3 && spread <= 0.06) {
    return { state: "supported", label: "Supported consensus", detail: `${depth} / ${disagreement}.`, influenceLabel };
  }
  return { state: "mixed", label: "Mixed market view", detail: `${depth} / ${disagreement}.`, influenceLabel };
}
