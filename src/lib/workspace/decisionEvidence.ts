import type { DecisionMarketAnalysis, DecisionSummary } from "@/lib/sports/types";

export function decisionEvidence(summary: DecisionSummary, row: DecisionMarketAnalysis) {
  const expiries = [summary.expiresAt, row.expiresAt].filter((value): value is string => value != null);
  return {
    modelVersion: summary.auditSummary?.modelVersion ?? null,
    evidenceHash: summary.auditSummary?.evidenceHash ?? null,
    oddsSnapshotId: row.oddsSnapshotId ?? null,
    expiresAt: expiries.sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
  };
}
