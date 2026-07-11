import type { ConfidenceLevel, RiskLevel } from "@/lib/sports/types";

function clampProbability(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function confidenceFromEdgeAndProbability(
  edge: number,
  probability: number,
  dataQuality: number
): ConfidenceLevel {
  const quality = clampProbability(dataQuality);
  const boundedProbability = clampProbability(probability);
  const qualityPenalty = quality < 0.62 ? -0.04 : quality < 0.74 ? -0.02 : 0;
  const adjustedEdge = edge + qualityPenalty;

  if (adjustedEdge >= 0.075 && boundedProbability >= 0.47 && quality >= 0.78) return "high";
  if (adjustedEdge >= 0.025 && boundedProbability >= 0.38 && quality >= 0.64) return "medium";
  return "low";
}

export function riskLevelFromConfidenceAndOdds(confidence: ConfidenceLevel, odds: number): RiskLevel {
  if (confidence === "high" && odds <= 2.4) return "low";
  if (confidence === "low" || odds >= 3.75) return "high";
  return "medium";
}
