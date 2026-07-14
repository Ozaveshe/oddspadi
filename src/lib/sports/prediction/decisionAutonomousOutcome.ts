import type { DecisionEngineReport, Match, Prediction, ValueEdge } from "@/lib/sports/types";
import type { PredictionOutcomeInput } from "@/lib/sports/prediction/decisionOutcomes";

function strongestEvaluationEdge(prediction: Prediction): ValueEdge | null {
  return prediction.canonicalDecision.bestPublishedPick ??
    prediction.canonicalDecision.bestLean ??
    prediction.canonicalDecision.bestWatchlistCandidate;
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
  const publicAction = prediction.canonicalDecision.publicStatus === "value_pick"
    ? "consider"
    : prediction.canonicalDecision.publicStatus === "lean" ||
        prediction.canonicalDecision.publicStatus === "watchlist" ||
        prediction.canonicalDecision.publicStatus === "stale"
      ? "monitor"
      : "avoid";

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
      finalAction: publicAction,
      finalVerdict: prediction.canonicalDecision.publicStatus,
      finalConfidence: prediction.canonicalDecision.confidence,
      finalRisk: prediction.canonicalDecision.risk,
      agentFinalAction: finalDecision.action,
      agentFinalVerdict: finalDecision.verdict,
      agentFinalConfidence: finalDecision.confidence,
      agentFinalRisk: finalDecision.risk,
      recommendedSelection: edge.label,
      hadValuePick: prediction.canonicalDecision.publicStatus === "value_pick",
      publicStatus: prediction.canonicalDecision.publicStatus,
      evaluationPolicy: "canonical-decision-summary"
    }
  };
}
