import type { DecisionSummary, Match, Prediction } from "@/lib/sports/types";

const VOLATILE_EVIDENCE_KEYS = new Set([
  "generatedAt",
  "startedAt",
  "completedAt",
  "dueAt",
  "nextReviewAt"
]);

function stableEvidenceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableEvidenceValue);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_EVIDENCE_KEYS.has(key))
      .map(([key, nested]) => [key, stableEvidenceValue(nested)])
  );
}

function stableHash(value: unknown): string {
  const text = JSON.stringify(stableEvidenceValue(value));
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `decision-evidence-v1:fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildDecisionSummaryHash(summary: DecisionSummary): string {
  const { summaryHash: _summaryHash, ...auditSummary } = summary.auditSummary;
  return stableHash({ ...summary, auditSummary }).replace("decision-evidence-v1", "decision-summary-v1");
}

export function withDecisionSummaryHash(summary: DecisionSummary): DecisionSummary {
  return {
    ...summary,
    auditSummary: {
      ...summary.auditSummary,
      summaryHash: buildDecisionSummaryHash(summary)
    }
  };
}

export type PredictionEvidenceInput = Pick<
  Prediction,
  | "markets"
  | "diagnostics"
  | "calibrationAdjustment"
  | "contextAdjustment"
  | "marketPriorAdjustment"
  | "valueEdges"
  | "decision"
>;

/**
 * Identifies the complete evidence/model snapshot rendered by match detail.
 * Runtime clocks are excluded, while source observation and odds timestamps
 * remain part of the identity because they affect freshness and publication.
 */
export function buildPredictionEvidenceHash({
  match,
  prediction
}: {
  match: Match;
  prediction: PredictionEvidenceInput;
}): string {
  return stableHash({
    fixture: match,
    model: {
      markets: prediction.markets,
      diagnostics: prediction.diagnostics,
      probabilityCalibration: prediction.calibrationAdjustment ?? null,
      contextAdjustment: prediction.contextAdjustment,
      marketPriorAdjustment: prediction.marketPriorAdjustment,
      valueEdges: prediction.valueEdges,
      decision: prediction.decision
    }
  });
}

/**
 * A stored headline may replace the fresh canonical headline only when it was
 * derived from the exact evidence, model, and engine rendered below it.
 */
export function resolveCanonicalDecisionForMatchDetail({
  freshPrediction,
  storedSummary
}: {
  freshPrediction: Prediction;
  storedSummary: DecisionSummary | null;
}): DecisionSummary {
  if (!storedSummary) return freshPrediction.canonicalDecision;

  const storedAudit = storedSummary.auditSummary;
  const freshAudit = freshPrediction.canonicalDecision.auditSummary;
  const compatible =
    storedSummary.fixtureId === freshPrediction.matchId &&
    Boolean(storedAudit.evidenceHash) &&
    storedAudit.evidenceHash === freshPrediction.evidenceHash &&
    freshAudit.evidenceHash === freshPrediction.evidenceHash &&
    Boolean(storedAudit.summaryHash) &&
    storedAudit.summaryHash === freshAudit.summaryHash &&
    storedAudit.summaryHash === buildDecisionSummaryHash(storedSummary) &&
    storedAudit.modelVersion === freshPrediction.diagnostics.modelVersion &&
    storedAudit.engineVersion === freshPrediction.decision.engineVersion;

  return compatible ? storedSummary : freshPrediction.canonicalDecision;
}
