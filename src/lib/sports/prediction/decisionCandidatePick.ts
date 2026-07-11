import type { BestPickResult, Prediction } from "@/lib/sports/types";

export function decisionCandidatePick(prediction: Pick<Prediction, "bestPick" | "decision">): BestPickResult {
  if (prediction.bestPick.hasValue) return prediction.bestPick;

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
