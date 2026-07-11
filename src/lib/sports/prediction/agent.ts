import type { BestPickResult, FootballModelDiagnostics, Match, PredictionAgentReport, ValueEdge } from "@/lib/sports/types";
import { formatOdds, formatPercent, formatSignedPercent } from "./format";

function fairOdds(probability: number): number | null {
  if (probability <= 0) return null;
  return 1 / probability;
}

function describeFairOdds(edge: ValueEdge): string {
  const odds = fairOdds(edge.modelProbability);
  if (!odds) return "Fair odds are unavailable because the model probability is zero.";

  return `Model fair odds for ${edge.label} are about ${formatOdds(odds)}, compared with market odds of ${formatOdds(
    edge.odds
  )}.`;
}

function describeUncertaintyAdjustedScore(edge: ValueEdge): string | null {
  if (typeof edge.uncertaintyAdjustedScore !== "number" || !edge.scoreComponents) return null;
  const memoryNote =
    typeof edge.scoreComponents.caseMemoryPenalty === "number" && edge.scoreComponents.caseMemoryPenalty > 0
      ? ` Case memory penalty is ${edge.scoreComponents.caseMemoryPenalty.toFixed(4)} from similar stored decisions.`
      : "";
  const priceNote =
    typeof edge.scoreComponents.priceFragilityPenalty === "number" && edge.scoreComponents.priceFragilityPenalty > 0
      ? ` Price fragility penalty is ${edge.scoreComponents.priceFragilityPenalty.toFixed(4)} with ${(
          (edge.scoreComponents.priceShorteningTolerance ?? 0) * 100
        ).toFixed(1)}% shortening tolerance.`
      : "";

  return `Uncertainty-adjusted value score is ${edge.uncertaintyAdjustedScore.toFixed(4)} after EV, edge, probability stability, bookmaker margin, odds volatility, price resilience, confidence, risk, and case-memory penalties.${priceNote}${memoryNote}`;
}

function expectedScoreText(match: Match, diagnostics: FootballModelDiagnostics): string {
  if (diagnostics.expectedScoreLabel) return diagnostics.expectedScoreLabel;
  const unit = diagnostics.scoreUnit ?? "goals";
  return `Expected ${unit} are ${diagnostics.expectedGoals.home.toFixed(2)} for ${match.homeTeam.name} and ${diagnostics.expectedGoals.away.toFixed(
    2
  )} for ${match.awayTeam.name}.`;
}

export function buildPredictionAgentReport(
  match: Match,
  diagnostics: FootballModelDiagnostics,
  bestPick: BestPickResult,
  valueEdges: ValueEdge[]
): PredictionAgentReport {
  const strongestEdges = [...valueEdges].sort((a, b) => b.edge - a.edge).slice(0, 3);
  const cautions: string[] = [
    "No prediction is guaranteed; this is statistical analysis only.",
    "Do not treat positive edge as a requirement to place a bet."
  ];

  if (diagnostics.uncertainty !== "low") {
    cautions.push(`Model uncertainty is ${diagnostics.uncertainty} because data quality is ${formatPercent(diagnostics.dataQualityScore)}.`);
  }

  if (bestPick.hasValue && bestPick.odds >= 3.5) {
    cautions.push("Higher odds can carry more variance even when the calculated edge is positive.");
  }

  if (!bestPick.hasValue) {
    return {
      verdict: "no-clear-value",
      summary: `The agent does not see enough separation between OddsPadi probabilities and no-vig market probabilities for ${match.homeTeam.name} vs ${match.awayTeam.name}.`,
      reasons: [
        "The strongest available edges do not meet the confidence threshold.",
        expectedScoreText(match, diagnostics),
        diagnostics.topOutcomeLabel ??
          `Top scoreline estimate: ${diagnostics.topCorrectScores[0]?.homeGoals ?? 0}-${diagnostics.topCorrectScores[0]?.awayGoals ?? 0}.`
      ],
      cautions,
      mathNotes: diagnostics.calibrationNotes
    };
  }

  return {
    verdict: bestPick.confidence === "high" ? "value-found" : "watchlist",
    summary: `The agent flags ${bestPick.label} as a ${bestPick.confidence}-confidence value candidate with a ${formatSignedPercent(
      bestPick.edge
    )} edge and ${formatSignedPercent(bestPick.expectedValue)} EV.`,
    reasons: [
      `${bestPick.label} model probability is ${formatPercent(bestPick.modelProbability)} versus ${formatPercent(
        bestPick.noVigImpliedProbability
      )} no-vig implied by the odds. Raw implied is ${formatPercent(bestPick.rawImpliedProbability)} before market margin of ${formatSignedPercent(
        bestPick.bookmakerMargin
      )}. Expected value is ${formatSignedPercent(bestPick.expectedValue)} per unit.`,
      describeFairOdds(bestPick),
      describeUncertaintyAdjustedScore(bestPick),
      expectedScoreText(match, diagnostics),
      `Strongest edges reviewed: ${strongestEdges
        .map((edge) => `${edge.label} ${formatSignedPercent(edge.edge)} edge, ${formatSignedPercent(edge.expectedValue)} EV`)
        .join(", ")}.`
    ].filter((reason): reason is string => Boolean(reason)),
    cautions,
    mathNotes: diagnostics.calibrationNotes
  };
}
