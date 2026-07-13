import type { Match, Prediction } from "@/lib/sports/types";

/**
 * Slim projections for list surfaces (match cards, prediction tables, slip
 * buttons). A full Prediction carries the entire decision-engine dossier
 * (evidence trees, agent report, diagnostics) and a full Match carries form
 * history, head-to-head and league tables — none of which list UIs render.
 * Serializing the full objects into client-component props inflated the
 * /predictions HTML to ~6.7 MB; these summaries keep it to the fields the
 * list components actually read.
 */
export type MatchSummary = Pick<
  Match,
  "id" | "sport" | "league" | "kickoffTime" | "homeTeam" | "awayTeam" | "status" | "oddsMarkets" | "dataSource"
>;

export type PredictionSummary = Pick<
  Prediction,
  "matchId" | "sport" | "generatedAt" | "markets" | "bestPick" | "confidence" | "risk"
>;

export type PredictionListRow = { match: MatchSummary; prediction: PredictionSummary };

export function toMatchSummary(match: Match): MatchSummary {
  return {
    id: match.id,
    sport: match.sport,
    league: match.league,
    kickoffTime: match.kickoffTime,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    status: match.status,
    oddsMarkets: match.oddsMarkets,
    dataSource: match.dataSource
  };
}

export function toPredictionSummary(prediction: Prediction): PredictionSummary {
  return {
    matchId: prediction.matchId,
    sport: prediction.sport,
    generatedAt: prediction.generatedAt,
    markets: prediction.markets,
    bestPick: prediction.bestPick,
    confidence: prediction.confidence,
    risk: prediction.risk
  };
}

export function toPredictionListRow(row: { match: Match; prediction: Prediction }): PredictionListRow {
  return { match: toMatchSummary(row.match), prediction: toPredictionSummary(row.prediction) };
}
