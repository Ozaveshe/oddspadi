import type { Prediction } from "@/lib/sports/types";
import type { MatchSummary, PredictionSummary } from "@/lib/sports/prediction/listRow";

export const BET_SLIP_STORAGE_KEY = "oddspadi-bet-slip-v1";
export const BET_SLIP_CHANGED_EVENT = "oddspadi:bet-slip-changed";
export type SlipLeg = { id: string; matchId: string; matchLabel: string; league: string; kickoffTime: string; selection: string; decimalOdds: number; modelProbability: number; noVigProbability: number; risk: Prediction["risk"] };
export type SlipAnalysis = { combinedOdds: number; modelProbability: number; bookmakerProbability: number; probabilityGap: number; weakestLegId: string | null };

function isSlipLeg(value: unknown): value is SlipLeg {
  if (!value || typeof value !== "object") return false;
  const leg = value as Partial<SlipLeg>;
  return typeof leg.id === "string"
    && typeof leg.matchId === "string"
    && typeof leg.matchLabel === "string"
    && typeof leg.league === "string"
    && typeof leg.kickoffTime === "string"
    && typeof leg.selection === "string"
    && typeof leg.decimalOdds === "number"
    && Number.isFinite(leg.decimalOdds)
    && leg.decimalOdds > 1
    && typeof leg.modelProbability === "number"
    && Number.isFinite(leg.modelProbability)
    && leg.modelProbability > 0
    && leg.modelProbability <= 1;
}

export function slipLegFromPrediction(match: MatchSummary, prediction: PredictionSummary): SlipLeg | null {
  if (prediction.bestPick.hasValue && prediction.bestPick.odds > 1 && prediction.bestPick.modelProbability > 0) return { id: `${match.id}:${prediction.bestPick.marketId}:${prediction.bestPick.selectionId}`, matchId: match.id, matchLabel: `${match.homeTeam.name} vs ${match.awayTeam.name}`, league: match.league.name, kickoffTime: match.kickoffTime, selection: prediction.bestPick.label, decimalOdds: prediction.bestPick.odds, modelProbability: prediction.bestPick.modelProbability, noVigProbability: prediction.bestPick.noVigImpliedProbability, risk: prediction.bestPick.risk };
  const market = prediction.markets.find((item) => item.marketId === "match_winner"); const odds = match.oddsMarkets.find((item) => item.id === "match_winner")?.selections ?? [];
  const candidates = [{ id: "home", label: match.homeTeam.name, probability: market?.probabilities.home ?? 0 }, ...(match.sport === "football" ? [{ id: "draw", label: "Draw", probability: market?.probabilities.draw ?? 0 }] : []), { id: "away", label: match.awayTeam.name, probability: market?.probabilities.away ?? 0 }]; const best = candidates.sort((a,b) => b.probability-a.probability)[0]; const price = odds.find((item) => item.id === best.id);
  if (!price || price.decimalOdds <= 1 || best.probability <= 0) return null; return { id: `${match.id}:match_winner:${best.id}`, matchId: match.id, matchLabel: `${match.homeTeam.name} vs ${match.awayTeam.name}`, league: match.league.name, kickoffTime: match.kickoffTime, selection: best.label, decimalOdds: price.decimalOdds, modelProbability: best.probability, noVigProbability: 1 / price.decimalOdds, risk: prediction.risk };
}
export function analyzeSlip(legs: SlipLeg[]): SlipAnalysis {
  if (!legs.length) return { combinedOdds: 1, modelProbability: 0, bookmakerProbability: 0, probabilityGap: 0, weakestLegId: null };
  const combinedOdds = legs.reduce((value, leg) => value * leg.decimalOdds, 1);
  const modelProbability = legs.reduce((value, leg) => value * leg.modelProbability, 1);
  const bookmakerProbability = 1 / combinedOdds;
  const weakest = legs.reduce<SlipLeg | null>((current, leg) => !current || leg.modelProbability < current.modelProbability ? leg : current, null);
  return { combinedOdds, modelProbability, bookmakerProbability, probabilityGap: modelProbability - bookmakerProbability, weakestLegId: weakest?.id ?? null };
}

export function readSlip(): SlipLeg[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(BET_SLIP_STORAGE_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter(isSlipLeg).slice(0, 20) : [];
  } catch {
    return [];
  }
}

export function writeSlip(legs: SlipLeg[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(BET_SLIP_STORAGE_KEY, JSON.stringify(legs.filter(isSlipLeg).slice(0, 20)));
    window.dispatchEvent(new Event(BET_SLIP_CHANGED_EVENT));
    return true;
  } catch {
    return false;
  }
}
