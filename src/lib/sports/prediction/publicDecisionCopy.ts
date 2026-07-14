import type { DecisionSummary } from "@/lib/sports/types";

export function publicWatchlistReason(summary: DecisionSummary): string {
  const blockers = [
    ...(summary.bestWatchlistCandidate?.blockers ?? []),
    ...summary.auditSummary.blockers
  ];
  if (summary.publicStatus === "stale" || blockers.some((blocker) => blocker.includes("odds snapshot is stale"))) {
    return "Watchlist — the odds snapshot is stale, so the edge cannot be published.";
  }
  if (summary.evidenceQuality === "thin" || summary.evidenceQuality === "missing") {
    return "Watchlist — historical and context evidence is too thin for publication.";
  }
  if (blockers.some((blocker) => blocker.includes("required production evidence"))) {
    return "Watchlist — required verified evidence is incomplete.";
  }
  return summary.noPickReason ?? "Watchlist — stronger evidence is required before publication.";
}
