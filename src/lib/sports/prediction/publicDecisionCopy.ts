import type { DecisionSummary } from "@/lib/sports/types";

export function publicWatchlistReason(summary: DecisionSummary): string {
  const blockers = [
    ...(summary.bestWatchlistCandidate?.blockers ?? []),
    ...summary.auditSummary.blockers
  ];
  if (summary.publicStatus === "stale" || blockers.some((blocker) => blocker.includes("odds snapshot is stale"))) {
    return "Watch — the odds snapshot is stale, so the edge cannot be published.";
  }
  if (summary.evidenceQuality === "thin" || summary.evidenceQuality === "missing") {
    return "Watch — historical and context evidence is too thin for publication.";
  }
  if (blockers.some((blocker) => blocker.includes("required production evidence"))) {
    return "Watch — required verified evidence is incomplete.";
  }
  return summary.noPickReason ?? "Watch — stronger evidence is required before publication.";
}
