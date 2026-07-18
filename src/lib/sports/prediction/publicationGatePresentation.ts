import type { DecisionMarketAnalysis } from "@/lib/sports/types";

export type PublicationGateReceipt = Pick<
  DecisionMarketAnalysis,
  "analysisStatus" | "publicationEligible" | "blockers" | "expiresAt"
>;

export type PublicationGatePresentation = {
  state: "cleared" | "watch" | "refresh" | "blocked" | "missing";
  label: string;
  detail: string;
  shortLabel: string;
};

function sentence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "The canonical decision did not record a reason.";
  return `${trimmed[0]?.toUpperCase() ?? ""}${trimmed.slice(1)}${/[.!?]$/.test(trimmed) ? "" : "."}`;
}

export function buildPublicationGatePresentation(
  receipt?: PublicationGateReceipt | null
): PublicationGatePresentation {
  if (!receipt) {
    return {
      state: "missing",
      label: "Publication gate unavailable",
      detail: "This price case has no canonical publication receipt.",
      shortLabel: "No gate receipt"
    };
  }

  if (receipt.publicationEligible && receipt.analysisStatus === "published_value_pick") {
    return {
      state: "cleared",
      label: "Publication gates cleared",
      detail: receipt.expiresAt
        ? `This value claim remains price-bound until ${new Date(receipt.expiresAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`
        : "The current canonical receipt permits a public value claim.",
      shortLabel: "Publishable"
    };
  }

  const blocker = sentence(receipt.blockers[0] ?? "A complete publication condition is still missing");
  if (receipt.analysisStatus === "stale") {
    return {
      state: "refresh",
      label: "Fresh price required",
      detail: blocker,
      shortLabel: "Refresh"
    };
  }
  if (receipt.analysisStatus === "lean") {
    return {
      state: "watch",
      label: "Lean only — not a value pick",
      detail: blocker,
      shortLabel: "Lean only"
    };
  }
  if (receipt.analysisStatus === "watchlist" || receipt.analysisStatus === "needs_data") {
    return {
      state: "watch",
      label: "Analysis only — publication blocked",
      detail: blocker,
      shortLabel: "Watchlist"
    };
  }
  return {
    state: "blocked",
    label: "No public value claim",
    detail: blocker,
    shortLabel: "Blocked"
  };
}
