// Derived community-ledger state. Precedence: moderation shadows everything in
// display, a settled result is the ledger truth, a correction note marks an
// unsettled tip, otherwise the tip is pending. Deletion is deliberately NOT a
// status: a deleted tip keeps its settled result (the tombstone rule).
export type CommunityTipStatus = "pending" | "won" | "lost" | "push" | "void" | "corrected" | "moderated";

export type CommunityTipStatusInput = {
  moderatedAt?: string | null;
  settlement?: { result: "won" | "lost" | "push" | "void" } | null;
  revisions?: Array<{ revision_kind?: string | null }> | null;
};

export function communityTipStatus(tip: CommunityTipStatusInput): CommunityTipStatus {
  if (tip.moderatedAt) return "moderated";
  if (tip.settlement?.result) return tip.settlement.result;
  if ((tip.revisions ?? []).some((revision) => revision.revision_kind === "correction")) return "corrected";
  return "pending";
}

export const COMMUNITY_TIP_STATUS_LABEL: Record<CommunityTipStatus, string> = {
  pending: "Pending",
  won: "Won",
  lost: "Lost",
  push: "Push",
  void: "Void",
  corrected: "Corrected",
  moderated: "Moderated"
};
