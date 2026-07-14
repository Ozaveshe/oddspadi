import type { Match, MatchPredictionExplanation, PredictionMarket, ValueEdge } from "@/lib/sports/types";
import { formatPercent, formatSignedPercent } from "./format";

export function explainPrediction(
  match: Match,
  markets: PredictionMarket[],
  bestEdge?: ValueEdge
): MatchPredictionExplanation {
  const winner = markets.find((market) => market.marketId === "match_winner");
  const homeProbability = winner?.probabilities.home ?? 0;
  const awayProbability = winner?.probabilities.away ?? 0;
  const drawProbability = winner?.probabilities.draw ?? 0;
  const winnerSummary =
    match.sport === "football"
      ? `${match.homeTeam.name} at ${formatPercent(homeProbability)}, the draw at ${formatPercent(drawProbability)}, and ${match.awayTeam.name} at ${formatPercent(
          awayProbability
        )}`
      : `${match.homeTeam.name} at ${formatPercent(homeProbability)} and ${match.awayTeam.name} at ${formatPercent(awayProbability)}`;

  if (!bestEdge || bestEdge.edge <= 0) {
    return {
      summary: `OddsPadi estimates ${winnerSummary}. The current prices do not show a clear positive value edge, so the responsible call is to avoid forcing a pick.`,
      drivers: [
        "The model weighs ratings, recent form, attack and defensive strength.",
        ...(match.headToHead ? [`Recent H2H (${match.headToHead.meetings.length}): ${match.homeTeam.name} ${match.headToHead.homeWins} wins, ${match.headToHead.draws} draws, ${match.awayTeam.name} ${match.headToHead.awayWins} wins.`] : []),
        "Bookmaker margin is removed where possible before value edge is calculated.",
        "Confidence stays cautious when the edge is weak or data quality is limited."
      ],
      disclaimer: "Sports outcomes are uncertain. Predictions are model estimates, not guarantees."
    };
  }

    return {
      summary: `OddsPadi gives ${bestEdge.label} a ${formatPercent(
      bestEdge.modelProbability
    )} estimated chance, while the no-vig market probability is ${formatPercent(
      bestEdge.noVigImpliedProbability
    )}. Raw implied is ${formatPercent(bestEdge.rawImpliedProbability)} before a market margin of ${formatSignedPercent(
      bestEdge.bookmakerMargin
    )}. That creates a possible ${formatSignedPercent(
      bestEdge.edge
    )} value edge and ${formatSignedPercent(bestEdge.expectedValue)} expected return per unit. Confidence is ${
      bestEdge.confidence
    } because the model signal is positive, but match outcomes remain uncertain.`,
    drivers: [
      `${match.homeTeam.name} recent form: ${match.homeForm.recentResults.join("-")}.`,
      `${match.awayTeam.name} recent form: ${match.awayForm.recentResults.join("-")}.`,
      ...(match.headToHead ? [`Recent H2H (${match.headToHead.meetings.length}): ${match.homeTeam.name} ${match.headToHead.homeWins} wins, ${match.headToHead.draws} draws, ${match.awayTeam.name} ${match.headToHead.awayWins} wins.`] : []),
      `Data quality score is ${formatPercent(match.dataQualityScore)}, so the output should be read as analysis only.`
    ],
    disclaimer: "Sports outcomes remain uncertain. Use OddsPadi as analysis, not certainty."
  };
}
