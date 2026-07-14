import type { BestPickResult, Prediction } from "@/lib/sports/types";
import { bestPickFromCanonicalDecision } from "./canonicalDecision";

/**
 * Internal shadow-learning candidate. Public UI, public persistence, and the
 * results ledger must use prediction.canonicalDecision instead.
 */
export function decisionCandidatePick(prediction: Pick<Prediction, "canonicalDecision" | "decision">): BestPickResult {
  const published = bestPickFromCanonicalDecision(prediction.canonicalDecision);
  if (published.hasValue) return published;

  const candidate = prediction.decision.oddsIntelligence.bestActionableSelection;
  if (!candidate || candidate.edge <= 0 || candidate.expectedValue <= 0) {
    return { hasValue: false, label: "No clear value found" };
  }

  return {
    hasValue: true,
    marketId: candidate.marketId,
    selectionId: candidate.selectionId,
    label: candidate.label,
    modelProbability: candidate.modelProbability,
    rawImpliedProbability: candidate.rawImpliedProbability,
    noVigImpliedProbability: candidate.noVigImpliedProbability,
    impliedProbability: candidate.noVigImpliedProbability,
    bookmakerMargin: candidate.bookmakerMargin,
    edge: candidate.edge,
    expectedValue: candidate.expectedValue,
    expectedRoi: candidate.expectedValue,
    odds: candidate.odds,
    confidence: candidate.confidence,
    risk: candidate.risk,
    ...(candidate.uncertaintyAdjustedScore === null || candidate.uncertaintyAdjustedScore === undefined
      ? {}
      : { uncertaintyAdjustedScore: candidate.uncertaintyAdjustedScore })
  };
}
