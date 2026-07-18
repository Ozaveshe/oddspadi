import type { ValueEdgeEconomicConfidence } from "@/lib/sports/types";
import { formatPercent, formatSignedPercent } from "./format";

export type EconomicConfidencePresentation = {
  state: "survives" | "fails" | "unavailable" | "missing";
  label: string;
  detail: string;
  shortLabel: string;
};

function firstSentence(value: string): string {
  const trimmed = value.trim();
  const boundary = trimmed.indexOf(". ");
  return boundary >= 0 ? `${trimmed.slice(0, boundary)}.` : trimmed;
}

function unavailableReason(value: string): string {
  const reason = firstSentence(value)
    .replace(/^Empirical interval unavailable:\s*/i, "")
    .replace(/\.$/, "");
  return reason ? `${reason[0]?.toUpperCase() ?? ""}${reason.slice(1)}.` : "No active, model-matched calibration bucket supports this selection.";
}

export function buildEconomicConfidencePresentation(
  receipt?: ValueEdgeEconomicConfidence | null
): EconomicConfidencePresentation {
  if (!receipt) {
    return {
      state: "missing",
      label: "Empirical value floor not recorded",
      detail: "This legacy edge has no selection-level calibration receipt.",
      shortLabel: "No receipt"
    };
  }
  if (
    receipt.status !== "verified" ||
    receipt.probabilityLow === null ||
    receipt.edgeLow === null ||
    receipt.expectedValueLow === null
  ) {
    return {
      state: "unavailable",
      label: "Empirical value floor unavailable",
      detail: `${unavailableReason(receipt.detail)} Raw EV remains a point estimate, not statistically verified value.`,
      shortLabel: "Unverified"
    };
  }

  const survives = receipt.edgeLow > 0 && receipt.expectedValueLow > 0;
  return {
    state: survives ? "survives" : "fails",
    label: survives ? "95% value floor stays positive" : "95% value floor fails",
    detail: `Lower probability ${formatPercent(receipt.probabilityLow)}; edge ${formatSignedPercent(receipt.edgeLow)}; EV ${formatSignedPercent(receipt.expectedValueLow)} across ${receipt.sampleSize?.toLocaleString() ?? "an unreported number of"} comparable settled predictions.`,
    shortLabel: survives ? "Robust case" : "Point estimate only"
  };
}
