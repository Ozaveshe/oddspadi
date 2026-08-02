import type { SlatePublicStatus } from "@/lib/sports/intelligence/types";

/**
 * The one vocabulary for decision and settlement states.
 *
 * Before v1.7 the same state wore different words on different pages —
 * "Watchlist" here, "No Pick" there, "Needs data" and "Suspended" elsewhere —
 * which made the surfaces read as separate products and forced users to
 * re-learn the product's honesty rules on every page. Every user-facing label
 * for these states now comes from this module; a contract test bans the old
 * synonyms from components.
 *
 * The words, and why:
 * - "Value Pick" stays (long-standing brand term for a published selection).
 * - "Watch"      replaces "Watchlist" as the state label (the list itself may
 *                still be called the watchlist in prose).
 * - "Pass"       replaces "No Pick" — the engine looked and declined; that is
 *                a decision, not an absence.
 * - "Withheld"   replaces "Needs data" — a decision exists but the evidence
 *                bar is not met, so publication is withheld.
 * - "Stale"      unchanged: the price or evidence aged out.
 * - "Unavailable" replaces "Suspended" for provider-side gaps.
 */
export const DECISION_STATUS_LABELS: Record<SlatePublicStatus, string> = {
  value_pick: "Value Pick",
  lean: "Lean",
  watchlist: "Watch",
  no_clear_value: "Pass",
  preliminary: "Preliminary",
  ready: "Ready",
  stale: "Stale",
  needs_data: "Withheld",
  suspended: "Unavailable",
  settled: "Settled",
  needs_review: "Under review"
};

/** One-line explanations, for tooltips/legends. Same register everywhere. */
export const DECISION_STATUS_DESCRIPTIONS: Record<SlatePublicStatus, string> = {
  value_pick: "Published selection — every value, confidence and risk gate passed.",
  lean: "The model favours a side but the edge is below the publication bar.",
  watchlist: "Possible value being tracked; something still blocks publication.",
  no_clear_value: "The engine analysed the fixture and declined every market.",
  preliminary: "Early read ahead of full odds and evidence.",
  ready: "Analysis complete and current.",
  stale: "The price or evidence behind this reading has aged out.",
  needs_data: "Withheld — the evidence bar for publication is not met.",
  suspended: "Provider data for this fixture is currently unavailable.",
  settled: "The fixture finished and this decision has been graded.",
  needs_review: "Grading needs a human look before it counts."
};

export function decisionStatusLabel(status: SlatePublicStatus): string {
  return DECISION_STATUS_LABELS[status] ?? status;
}

/** Badge tone per status — previously duplicated as ad-hoc `badgeClass` helpers. */
export function decisionStatusBadgeClass(status: SlatePublicStatus): string {
  if (status === "value_pick") return "positive";
  if (status === "lean" || status === "ready") return "medium";
  if (status === "watchlist" || status === "preliminary") return "scheduled";
  if (status === "settled") return "finished";
  return "no-value";
}

export type SettlementState = "won" | "lost" | "push" | "void" | "pending" | "needs_review";

export const SETTLEMENT_LABELS: Record<SettlementState, string> = {
  won: "Won",
  lost: "Lost",
  push: "Push",
  void: "Void",
  pending: "Pending",
  needs_review: "Under review"
};

export function settlementLabel(state: string): string {
  return SETTLEMENT_LABELS[state as SettlementState] ?? state;
}
