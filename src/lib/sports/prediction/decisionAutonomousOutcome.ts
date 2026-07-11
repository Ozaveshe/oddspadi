import type { DecisionEngineReport, Match, Prediction, ValueEdge } from "@/lib/sports/types";
import type { PredictionOutcomeInput } from "@/lib/sports/prediction/decisionOutcomes";

function strongestEvaluationEdge(prediction: Prediction): ValueEdge | null {
  const matchWinner = prediction.valueEdges.filter((edge) => edge.marketId === "match_winner");
  const candidates = matchWinner.length ? matchWinner : prediction.valueEdges;
  return candidates.slice().sort((left, right) => {
    if (right.modelProbability !== left.modelProbability) return right.modelProbability - left.modelProbability;
    if (right.expectedValue !== left.expectedValue) return right.expectedValue - left.expectedValue;
    return left.selectionId.localeCompare(right.selectionId);
  })[0] ?? null;
}

export function buildAutonomousPendingOutcome({
  match,
  prediction,
  decisionRunId,
  evidenceHash,
  finalDecision
}: {
  match: Match;
  prediction: Prediction;
  decisionRunId: string;
  evidenceHash: string;
  finalDecision: Pick<DecisionEngineReport, "verdict" | "action" | "confidence" | "risk" | "recommendedSelection">;
}): PredictionOutcomeInput | null {
  const edge = strongestEvaluationEdge(prediction);
  if (!edge) return null;

  return {
    decisionRunId,
    fixtureExternalId: match.id,
    sport: match.sport,
    market: edge.marketId,
    selection: edge.selectionId,
    modelProbability: edge.modelProbability,
    impliedProbability: edge.noVigImpliedProbability,
    valueEdge: edge.edge,
    odds: edge.odds,
    closingOdds: null,
    result: "pending",
    settledAt: null,
    source: "autonomous-shadow",
    metadata: {
      paperOnly: true,
      evidenceHash,
      kickoffTime: match.kickoffTime,
      homeTeam: match.homeTeam.name,
      awayTeam: match.awayTeam.name,
      league: match.league.name,
      country: match.league.country,
      fixtureProvider: match.dataSource?.fixtureProvider ?? null,
      fixtureProviderId: match.dataSource?.fixtureProviderId ?? null,
      oddsProvider: match.dataSource?.oddsProvider ?? null,
      oddsProviderEventId: match.dataSource?.oddsProviderEventId ?? null,
      deterministicAction: prediction.decision.action,
      finalAction: finalDecision.action,
      finalVerdict: finalDecision.verdict,
      finalConfidence: finalDecision.confidence,
      finalRisk: finalDecision.risk,
      recommendedSelection: finalDecision.recommendedSelection,
      hadValuePick: prediction.bestPick.hasValue,
      evaluationPolicy: prediction.bestPick.hasValue ? "selected-value-pick" : "highest-match-winner-probability"
    }
  };
}
